import { and, eq } from 'drizzle-orm';
import { auth } from './auth';
import { db__dangerous } from './db';
import { withOrg } from './withOrg';
import { members, organizations } from './schemas/auth-schema';
import { findUser } from './users';
import type { User, Space } from 'agentview/apiTypes';
import { AgentViewError } from 'agentview';

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
  role: string,
  env?: string,
  organizationId: any,
}

export type ApiKeyPrincipal = {
  type: 'apiKey',
  env?: string,
  apiKey: NonNullable<Awaited<ReturnType<typeof verifyAndGetKey>>>,
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

export type ServicePrincipal = {
  type: 'service',
  env?: string,
  organizationId: string
}

export type PrivatePrincipal = MemberPrincipal | ApiKeyPrincipal;
export type Principal = MemberPrincipal | ApiKeyPrincipal | UserPrincipal | ApiKeyPublicPrincipal | ServicePrincipal;

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
    throw new AgentViewError("Unauthorized", 401);
  }
  return member.role
}

// async function requireOrganization(organizationId: string, userId: string) {
//   const organization = await db__dangerous.query.organizations.findFirst({ where: eq(organizations.id, organizationId) })
//   if (!organization) {
//     throw new AgentViewError("Organization not found", 404);
//   }

//   const member = await db__dangerous.query.members.findFirst({ where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)) })
//   if (!member) {
//     throw new AgentViewError("User is not a member of the organization", 401);
//   }

//   return organization
// }

/** --------- AUTHENTICATION --------- */

// setting x-user-token always forces either user principal or unauthorised.
// but it's not work just on its own, you gotta be authenticated first (via api key or member cookie)


async function getUserPrincipal(headers: Headers, organizationId: string, env?: string) : Promise<UserPrincipal | undefined> {
  const userToken = extractUserToken(headers);
  if (userToken) {
    const user = await withOrg(organizationId, tx => findUser(tx, { token: userToken }))
    if (!user) {
      throw new AgentViewError("Invalid User Token", 401);
    }
    return { type: 'user', user, organizationId, env }
  }
  return undefined;
}

export async function authnAllowAnon(headers: Headers): Promise<Principal> {
  const env  = headers.get('x-env') ?? undefined;

  // API Key is always required, let's verify
  const bearer = extractBearerToken(headers)

  if (!bearer) {
    throw new AgentViewError("Missing API Key", 401);
  }

  const { valid, error, key } = await auth.api.verifyApiKey({
    body: {
      key: bearer,
    },
  })

  if (error || !valid || !key) {
    throw new AgentViewError(error?.message ?? "Invalid API Key", 401);
  }

  // Let's extract and verify organization
  const organizationId = key.metadata?.organizationId;
  if (!organizationId) {
    throw new AgentViewError("The API Key is not associated with any organization.", 400);
  }

  const organization = await db__dangerous.query.organizations.findFirst({ where: eq(organizations.id, organizationId) })
  if (!organization) {
    throw new AgentViewError("The API Key is associated with organization that doesn't exist.", 404);
  }

  const member = await db__dangerous.query.members.findFirst({ where: and(eq(members.userId, key.userId), eq(members.organizationId, organizationId)) })
  if (!member) {
    throw new AgentViewError("The owner of the API Key is not a member of the organization.", 401);
  }

  let apiKeyPrincipal: ApiKeyPrincipal | ApiKeyPublicPrincipal;
  if (key.prefix === 'pk_') {
    apiKeyPrincipal = { type: 'apiKeyPublic', apiKey: key, organizationId: organizationId, env }
  }
  else if (key.prefix === 'sk_') {
    apiKeyPrincipal = { type: 'apiKey', apiKey: key, organizationId: organizationId, env }
  }
  else {
    throw new AgentViewError("Invalid API Key. The API Key must have pk_ or sk_ prefix.", 401);
  }

  // User principal overrides API Key and member principal (based on x-user-token header)
  const userPrincipal = await getUserPrincipal(headers, organization.id, env)
  if (userPrincipal) {
    return userPrincipal;
  }

  // member principal (cookies), overrides API Key principal
  const memberSession = await auth.api.getSession({ headers })

  if (memberSession) {
    if (apiKeyPrincipal.type === 'apiKey') {
      throw new AgentViewError("Authorizing via member cookie is allowed only with public API key.", 401);
    }

    const role = await getRole(memberSession.user.id, organization.id)
    return { type: 'member', session: memberSession, role, organizationId: organization.id, env }
  }

  return apiKeyPrincipal;
}

export async function authnAllowPublic(headers: Headers): Promise<ServicePrincipal | PrivatePrincipal | UserPrincipal> {
  const principal = await authnAllowAnon(headers);

  if (principal.type === 'apiKeyPublic') {
    throw new AgentViewError("This endpoint requires user authentication. Please provide user token.", 401);
  }

  return principal;
}

export async function authn(headers: Headers): Promise<ServicePrincipal | PrivatePrincipal> {
  const principal = await authnAllowAnon(headers);

  if (principal.type === 'apiKeyPublic' || principal.type === 'user') {
    throw new AgentViewError("This endpoint is not available for public API keys. You should use it server-side with secret API key.", 401);
  }

  return principal;
}

// export async function authnAllowPublic(headers: Headers): Promise<Principal> {
//   return await getPrincipal(headers);
// }

/** --------- PRINCIPAL HELPERS --------- */

export function requireMemberPrincipal(principal: Principal) {
  if (principal.type === 'member') {
    return principal;
  }
  throw new AgentViewError("Unauthorized", 401);
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
      throw new AgentViewError("Unauthorized. Production data can be only accessed with production environment.", 401);
    }

    if (principal.type === 'service') {
      return true;
    }
    else if (principal.type === 'user') {
      if (action.action === "end-user:read" || action.action === "end-user:update") {
        if (action.user.id === principal.user.id) {
          return true;
        }
      }
    }
    else if (principal.type === 'member') {
      const memberId = principal.session.user.id

      if (action.action === "end-user:read" && (action.user.space === 'production' || action.user.space === 'shared-playground' || (action.user.space === 'playground' && action.user.ownerId === memberId))) {
        return true;
      }

      if (action.action === "end-user:create") {
        return true;
      }

      if (action.action === "end-user:update" && action.user.ownerId === memberId) {
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

  throw new AgentViewError("Unauthorized", 401);
}
