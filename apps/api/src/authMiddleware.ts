import { HTTPException } from 'hono/http-exception';
import { and, eq } from 'drizzle-orm';
import { auth } from './auth';
import { db__dangerous } from './db';
import { withOrg } from './withOrg';
import { members, organizations } from './schemas/auth-schema';
import { findUser } from './users';
import type { User, Space } from 'agentview/apiTypes';
import { requireEnvironment } from './environments';

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
  env?: string,
  role: string,
  organizationId: any,
}

export type ApiKeyPrincipal = {
  type: 'apiKey',
  env?: string,
  apiKey: NonNullable<Awaited<ReturnType<typeof verifyAndGetKey>>>,
  // role: string,
  organizationId: any,
}

export type ApiKeyPublicPrincipal = {
  type: 'apiKeyPublic',
  env?: string,
  apiKey: NonNullable<Awaited<ReturnType<typeof verifyAndGetKey>>>,
  organizationId: any,
}

export type UserPrincipal = {
  type: 'user',
  env?: string,
  user: User,
  organizationId: string
}

export type PrivatePrincipal = MemberPrincipal | ApiKeyPrincipal;
export type Principal = MemberPrincipal | ApiKeyPrincipal | UserPrincipal | ApiKeyPublicPrincipal;

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

// setting x-user-token always forces either user principal or unauthorised.
// but it's not work just on its own, you gotta be authenticated first (via api key or member cookie)
export async function getPrincipal(headers: Headers): Promise<Principal | undefined> {
  const env  = headers.get('x-env') ?? undefined;

  // See whether it's gonna be user principal
  let userPrincipal: UserPrincipal | undefined;
  const userToken = extractUserToken(headers);
  if (userToken) {
    const user = await db__dangerous.transaction(async tx => {
      return await findUser(tx, { token: userToken })
    })
    if (user) {
      userPrincipal = { type: 'user', user, organizationId: user.organizationId, env }
    }
    else {
      return; // if you gave user token it must be correct, otherwise it's unauthorised
    }
  }

  // members (cookies)
  const memberSession = await auth.api.getSession({ headers })

  if (memberSession) {
    if (userPrincipal) {
      return userPrincipal;
    }

    const organization = await requireOrganization(headers)
    const role = await getRole(memberSession.user.id, organization.id)

    return { type: 'member', session: memberSession, role, organizationId: organization.id, env }
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
      if (userPrincipal) {
        return userPrincipal;
      }

      const organization = await requireOrganization(key.metadata?.organizationId ?? "");
      // const role = await getRole(key.userId, organization.id)

      if (key.prefix === 'pk_') {
        return { type: 'apiKeyPublic', apiKey: key, organizationId: organization.id, env }
      }
      else {
        return { type: 'apiKey', apiKey: key, organizationId: organization.id, env }
      }
    }
  }

  // // TODO -> REMOVE IT!!!
  // if (userPrincipal) {
  //   return userPrincipal;
  // }
}

export async function authn(headers: Headers): Promise<PrivatePrincipal> {
  const principal = await getPrincipal(headers);
  if (!principal || principal.type === 'user' || principal.type === 'apiKeyPublic') {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  return principal;
}

export async function authnAllowPublic(headers: Headers): Promise<Principal> {
  const principal = await getPrincipal(headers);
  if (principal) {
    return principal;
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

// export function getMemberId(principal: PrivatePrincipal) {
//   if (principal.type === 'member') {
//     return principal.session.user.id;
//   }
//   else if (principal.type === 'apiKey') {
//     if (principal.apiKey.metadata?.env !== 'prod') {
//       return principal.apiKey.userId;
//     }
//   }
//   return null;
// }

// export function requireMemberId(principal: PrivatePrincipal) {
//   if (principal.type === 'member') {
//     return principal.session.user.id;
//   }
//   throw new HTTPException(401, { message: "Unauthorized" });
// }

// export function getEnv(principal: PrivatePrincipal): Env {
//   if (principal.type === 'apiKey') {
//     return principal.apiKey.metadata?.env === 'prod' ? { type: 'prod' } : { type: 'dev', memberId: principal.apiKey.userId };
//   }
//   else if (principal.type === 'member') {
//     return principal.env === 'prod' ? { type: 'prod' } : { type: 'dev', memberId: principal.session.user.id };
//   }
//   throw new HTTPException(401, { message: "Unauthorized" });
// }







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
  action: "environment:write"
} | {
  action: "environment:read"
}

// function validateIfEndUserWriteActionAllowed(principal: PrivatePrincipal, action: Action) {
//   const endUserBelongsToProdSpace =
//     (action.action === "end-user:create" && action.space === 'production') ||
//     (action.action === "end-user:update" && action.user.space === 'production');

//   if (endUserBelongsToProdSpace && principal.env !== 'production') {
//     throw new HTTPException(401, { message: "Production data can be only accessed with production environment." });
//   }

//   return true;
// }


export function authorize(principal: Principal, action: Action) {

  // sessions / end-users actions
  if (action.action === "end-user:read" || action.action === "end-user:update" || action.action === "end-user:create") {

    const endUserBelongsToProdSpace =
      (action.action === "end-user:create" && action.space === 'production') ||
      (action.action === "end-user:update" && action.user.space === 'production');

    if (endUserBelongsToProdSpace && principal.env !== 'production') {
      throw new HTTPException(401, { message: "Unauthorized. Production data can be only accessed with production environment." });
    }

    if (principal.type === 'user') {
      if (action.action === "end-user:read" || action.action === "end-user:update") {
        if (action.user.id === principal.user.id) {
          return true;
        }
      }
    }
    else if (principal.type === 'member') {
      const memberId = principal.session.user.id

      if (action.action === "end-user:read" && (action.user.space === 'production' || action.user.space === 'shared-playground' || (action.user.space === 'playground' && action.user.createdBy === memberId))) {
        return true;
      }

      if (action.action === "end-user:create") {
        return true;
      }

      if (action.action === "end-user:update" && action.user.createdBy === memberId) {
        return true;
      }
    }
    else if (principal.type === 'apiKey') {
      return true;
    }
    else if (principal.type === 'apiKeyPublic') {
      if (action.action === "end-user:create") {
        return true;
      }
    }
  }
  else if (action.action === "environment:read") {
    if (principal.type === 'apiKey' || principal.type === 'member') {
      return true;
    }
  }
  else if (action.action === "environment:write") {
    if (principal.type === 'apiKey' || principal.type === 'member') {
      return true;
    }
  }

  throw new HTTPException(401, { message: "Unauthorized" });
}
