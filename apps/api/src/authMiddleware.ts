import { HTTPException } from 'hono/http-exception';
import { and, eq } from 'drizzle-orm';
import { auth } from './auth';
import { db__dangerous } from './db';
import { withOrg } from './withOrg';
import { members, organizations } from './schemas/auth-schema';
import { findUser } from './users';
import type { User, Space } from 'agentview/apiTypes';
import type { Env } from './environments';

/** --------- TYPE INFERENCE HELPERS --------- */

async function getBetterAuthSession(headers: Headers) {
  const userSession = await auth.api.getSession({ headers })
  if (userSession) {
    return userSession
  }
  return;
}

async function verifyAndGetKey(bearer: string) {
  const maybeApiKey = await auth.api.verifyApiKey({
    body: {
      key: bearer,
    },
  })
  return maybeApiKey?.key;
}

/** --------- PRINCIPAL TYPES --------- */

export type MemberPrincipal = {
  type: 'member',
  session: NonNullable<Awaited<ReturnType<(typeof getBetterAuthSession)>>>,
  env: 'prod' | 'dev',
  role: string,
  organizationId: any,
  user?: User
}

export type ApiKeyPrincipal = {
  type: 'apiKey',
  apiKey: NonNullable<Awaited<ReturnType<typeof verifyAndGetKey>>>,
  role: string,
  organizationId: any,
  user?: User
}

export type UserPrincipal = {
  type: 'user',
  user: User,
  organizationId: string
}

export type PrivatePrincipal = MemberPrincipal | ApiKeyPrincipal;
export type Principal = MemberPrincipal | ApiKeyPrincipal | UserPrincipal;

/** --------- INTERNAL HELPERS --------- */

function extractBearerToken(headers: Headers) {
  const authorization = headers.get('authorization')
  if (!authorization) return null

  const [scheme, ...rest] = authorization.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || rest.length === 0) return null

  return rest.join(' ').trim()
}

function extractUserToken(headers: Headers) {
  const xUserToken = headers.get('x-user-token')
  if (!xUserToken) return null
  return xUserToken.trim()
}

async function getRole(userId: string, organizationId: string) {
  const member = await db__dangerous.query.members.findFirst({ where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)) })
  if (!member) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return member.role
}

async function requireOrganization(input: Headers | string) {
  const organizationId = typeof input === "string" ? input : input.get('x-organization-id')

  if (!organizationId) {
    throw new HTTPException(404, { message: "Organization ID is not provided." });
  }

  const organization = await db__dangerous.query.organizations.findFirst({ where: eq(organizations.id, organizationId) })
  if (!organization) {
    throw new HTTPException(404, { message: "Organization not found" });
  }
  return organization
}

async function requireUserByToken(organizationId: string, userToken: string) {
  const user = await withOrg(organizationId, tx => findUser(tx, { token: userToken }))
  if (!user) {
    throw new HTTPException(404, { message: "User not found." });
  }
  return user;
}

/** --------- AUTHENTICATION --------- */

export async function authn(headers: Headers): Promise<PrivatePrincipal> {
  const userToken = extractUserToken(headers)

  // members (cookies)
  const memberSession = await auth.api.getSession({ headers })

  if (memberSession) {
    const organization = await requireOrganization(headers)

    const envHeader  = headers.get('x-env') ?? 'dev';
    if (!['prod', 'dev'].includes(envHeader)) {
      throw new HTTPException(400, { message: "X-Env can be either 'prod' or 'dev'." });
    }
    const env = envHeader as 'prod' | 'dev';

    const role = await getRole(memberSession.user.id, organization.id)
    const user = userToken ? await requireUserByToken(organization.id, userToken) : undefined;

    return { type: 'member', session: memberSession, user, role, organizationId: organization.id, env }
  }

  // API Keys
  const bearer = extractBearerToken(headers)

  if (bearer) {
    const { valid, error, key } = await auth.api.verifyApiKey({
      body: {
        key: bearer,
      },
    })

    if (valid === true && !error && key) {
      const organization = await requireOrganization(key.metadata?.organizationId ?? "");
      const role = await getRole(key.userId, organization.id)
      const user = userToken ? await requireUserByToken(organization.id, userToken) : undefined;

      return { type: 'apiKey', apiKey: key, user, role, organizationId: organization.id }
    }
  }

  throw new HTTPException(401, { message: "Unauthorized" });
}

export async function authnUser(headers: Headers): Promise<UserPrincipal> {
  const userToken = extractUserToken(headers)

  if (userToken) {
    const user = await db__dangerous.transaction(async tx => {
      return await findUser(tx, { token: userToken })
    })
    if (user) {
      return { type: 'user', user, organizationId: user.organizationId }
    }
  }

  throw new HTTPException(401, { message: "Unauthorized" });
}

/** --------- PRINCIPAL HELPERS --------- */

export function requireMemberPrincipal(principal: Principal) {
  if (principal.type === 'member') {
    return principal;
  }
  throw new HTTPException(401, { message: "Unauthorized" });
}

export function getMemberId(principal: PrivatePrincipal) {
  if (principal.type === 'member') {
    return principal.session.user.id;
  }
  else if (principal.type === 'apiKey') {
    if (principal.apiKey.metadata?.env !== 'prod') {
      return principal.apiKey.userId;
    }
  }
  return null;
}

export function requireMemberId(principal: PrivatePrincipal) {
  const memberId = getMemberId(principal);
  if (!memberId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return memberId;
}

export function getEnv(principal: PrivatePrincipal): Env {
  if (principal.type === 'apiKey') {
    return principal.apiKey.metadata?.env === 'prod' ? { type: 'prod' } : { type: 'dev', memberId: principal.apiKey.userId };
  }
  else if (principal.type === 'member') {
    return principal.env === 'prod' ? { type: 'prod' } : { type: 'dev', memberId: principal.session.user.id };
  }
  throw new HTTPException(401, { message: "Unauthorized" });
}







/** --------- AUTHORIZATION --------- */

type Action = {
  action: "end-user:read",
  user: User,
} | {
  action: "end-user:update",
  user: User
} | {
  action: "end-user:create",
  space: Space
} | {
  action: "admin"
} | {
  action: "environment:write"
} | {
  action: "environment:read"
}

function validateIfEndUserWriteActionAllowed(principal: PrivatePrincipal, action: Action) {
  const env = getEnv(principal);

  const endUserBelongsToProdSpace =
    (action.action === "end-user:create" && action.space === 'production') ||
    (action.action === "end-user:update" && action.user.space === 'production');

  if (env.type === 'prod' || (env.type === 'dev' && !endUserBelongsToProdSpace)) {
    return true;
  }

  throw new HTTPException(401, { message: "End user write action not allowed in dev environment for end users in production space." });
}

export function authorize(principal: Principal, action: Action) {

  // sessions / end-users actions
  if (action.action === "end-user:read" || action.action === "end-user:update" || action.action === "end-user:create") {

    if (principal.type === 'user') {
      if (action.action === "end-user:read") {
        if (action.user.id === principal.user.id) {
          return true;
        }
      }
    }
    else if ((principal.type === 'apiKey' || principal.type === 'member') && principal.user) {
      if ((action.action === "end-user:read" || action.action === "end-user:update") && action.user.id === principal.user.id) {
        return true;
      }
    }
    else if (principal.type === 'member') {
      const memberId = principal.session.user.id

      if (action.action === "end-user:read" && (action.user.space === 'production' || action.user.space === 'shared-playground' || (action.user.space === 'playground' && action.user.createdBy === memberId))) {
        return true;
      }

      validateIfEndUserWriteActionAllowed(principal, action);

      if (action.action === "end-user:create") {
        return true;
      }

      if (action.action === "end-user:update" && action.user.createdBy === memberId) {
        return true;
      }
    }
    else if (principal.type === 'apiKey') {

      if (action.action === "end-user:read") {
        return true;
      }
      else {
        validateIfEndUserWriteActionAllowed(principal, action);
        return true;
      }
    }

  }
  else if (action.action === "admin") {
    if (principal.type === 'member' && (principal.role === "admin" || principal.role === "owner")) {
      return true;
    }
  }
  else if (action.action === "environment:read") {
    return true;
  }
  else if (action.action === "environment:write") {
    return true;
  }

  throw new HTTPException(401, { message: "Unauthorized" });
}
