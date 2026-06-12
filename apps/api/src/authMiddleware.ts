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

export function getPrincipalLogContext(p: Principal): { principalMemberId?: string; principalApiKeyId?: string; principalUserId?: string } {
  switch (p.type) {
    case 'member': return { principalMemberId: p.session.user.id };
    case 'apiKey':
    case 'apiKeyPublic': return { principalApiKeyId: p.apiKey.id };
    case 'user': return { principalUserId: p.user.id };
    case 'service': return {};
  }
}

/** --------- INTERNAL HELPERS --------- */

function extractBearerToken(headers: Headers) {
  const authorization = headers.get('authorization')
  if (!authorization) return null

  const [scheme, ...rest] = authorization.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || rest.length === 0) return null

  return rest.join(' ').trim()
}

function extractUserIdentifierFromHeaders(headers: Headers): { id: string } | { externalId: string } | { token: string } | null {
  const xUserToken = headers.get('x-user-token')?.trim()
  const xUserId = headers.get('x-user-id')?.trim()
  const xUserExternalId = headers.get('x-user-external-id')?.trim()

  if (xUserToken) {
    return { token: xUserToken }
  }
  if (xUserId) {
    return { id: xUserId }
  }
  if (xUserExternalId) {
    return { externalId: xUserExternalId }
  }
  return null;
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


async function getUserPrincipal(headers: Headers, organizationId: string, allowOnlyForToken: boolean, env?: string): Promise<UserPrincipal | undefined> {
  const userIdentifier = extractUserIdentifierFromHeaders(headers);

  if (!userIdentifier) {
    return undefined;
  }


  if ('token' in userIdentifier) {
    const user = await withOrg(organizationId, tx => findUser(tx, { token: userIdentifier.token }))
    if (!user) {
      throw new AgentViewError("Invalid User Token", 401);
    }
    return { type: 'user', user, organizationId, env }
  }

  if (allowOnlyForToken) {
    return undefined;
  }

  if ('id' in userIdentifier) {
    const user = await withOrg(organizationId, tx => findUser(tx, { id: userIdentifier.id }))
    if (!user) {
      throw new AgentViewError("Invalid User ID", 401);
    }
    return { type: 'user', user, organizationId, env }
  }

  if ('externalId' in userIdentifier) {
    const user = await withOrg(organizationId, tx => findUser(tx, { externalId: userIdentifier.externalId }))
    if (!user) {
      throw new AgentViewError("Invalid User External ID", 401);
    }
    return { type: 'user', user, organizationId, env }
  }

  return undefined;
}


async function verifyOrgAccess(organizationId: string, userId: string) {
  const organization = await db__dangerous.query.organizations.findFirst({ where: eq(organizations.id, organizationId) })
  if (!organization) {
    throw new AgentViewError("The API Key is associated with organization that doesn't exist.", 404);
  }

  const member = await db__dangerous.query.members.findFirst({ where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)) })
  if (!member) {
    throw new AgentViewError("The owner of the API Key is not a member of the organization.", 401);
  }
}

/** --------- BEARER PRINCIPAL CACHE --------- */

// better-auth's verifyApiKey UPDATEs the apikey row on every call, so all requests
// sharing one key serialize on a single row lock (and each waiter holds a pool
// connection). Caching the resolved bearer principal keeps verification down to
// one DB round trip per key per TTL. Tradeoff: key/session revocation and org
// membership changes take up to TTL to propagate.
const BEARER_CACHE_TTL_MS = 60_000;
const BEARER_CACHE_MAX_ENTRIES = 10_000;

type BearerPrincipal = MemberPrincipal | ApiKeyPrincipal | ApiKeyPublicPrincipal;

const bearerPrincipalCache = new Map<string, { principal: Promise<BearerPrincipal>, expiresAt: number }>();

function getCachedBearerPrincipal(cacheKey: string, resolve: () => Promise<BearerPrincipal>): Promise<BearerPrincipal> {
  const now = Date.now();

  const cached = bearerPrincipalCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.principal;
  }

  if (bearerPrincipalCache.size >= BEARER_CACHE_MAX_ENTRIES) {
    bearerPrincipalCache.clear();
  }

  // Cache the promise (not the result) so concurrent requests with the same
  // bearer trigger a single verification instead of a thundering herd.
  const principal = resolve();
  bearerPrincipalCache.set(cacheKey, { principal, expiresAt: now + BEARER_CACHE_TTL_MS });

  // Never cache failures (invalid key, transient DB error) — next request retries.
  principal.catch(() => {
    if (bearerPrincipalCache.get(cacheKey)?.principal === principal) {
      bearerPrincipalCache.delete(cacheKey);
    }
  });

  return principal;
}

export async function authnAllowAnon(headers: Headers): Promise<Principal> {
  const env = headers.get('x-env') ?? undefined;

  // API Key is always required, let's verify
  const bearer = extractBearerToken(headers)

  if (!bearer) {
    throw new AgentViewError("Missing API Key", 401);
  }

  // x-organization-id and cookies participate in member-session resolution, so they're part of the key
  const cacheKey = `${bearer}|${headers.get('x-organization-id') ?? ''}|${env ?? ''}|${headers.get('cookie') ?? ''}`;
  const bearerPrincipal = await getCachedBearerPrincipal(cacheKey, () => resolveBearerPrincipal(headers, bearer, env));

  // Potential user principal
  const allowOnlyForUserToken = bearerPrincipal.type === 'apiKeyPublic';
  const userPrincipal = await getUserPrincipal(headers, bearerPrincipal.organizationId, allowOnlyForUserToken, env)
  if (userPrincipal) {
    return userPrincipal;
  }

  return bearerPrincipal;
}

async function resolveBearerPrincipal(headers: Headers, bearer: string, env: string | undefined): Promise<BearerPrincipal> {
  let bearerPrincipal: BearerPrincipal

  // Check for member session
  const memberSession = await auth.api.getSession({ headers })

  // Session auth
  if (memberSession) {
    /**
     * Worth mentioning why we need this X-Organization-Id. 
     * 
     * The session auth uses Bearer token, the same as keys. But session bearer token doesn't have org info (and probably shouldn't have).
     * This is rare to use X-Organization-Id, almost like an edge case only for studio.
     */
    const organizationId = headers.get('x-organization-id') ?? undefined;
    if (!organizationId) {
      throw new AgentViewError("No organization ID provided in X-Organization-Id header (required for session authentication).", 401);
    }

    await verifyOrgAccess(organizationId, memberSession.user.id);

    const role = await getRole(memberSession.user.id, organizationId)
    bearerPrincipal = { type: 'member', session: memberSession, role, organizationId: organizationId, env }
  }
  // API Key auth
  else {
    const { valid, error, key } = await auth.api.verifyApiKey({
      body: {
        key: bearer,
      },
    })

    if (error || !valid || !key) {
      throw new AgentViewError(error ? String(error.message) : "Unknown error verifying API Key", 401);
    }

    // Let's extract and verify organization
    const organizationId = key.metadata?.organizationId;
    if (!organizationId) {
      throw new AgentViewError("The API Key is not associated with any organization.", 400);
    }

    await verifyOrgAccess(organizationId, key.referenceId);

    if (key.prefix === 'pk_') {
      bearerPrincipal = { type: 'apiKeyPublic', apiKey: key, organizationId: organizationId, env }
    }
    else if (key.prefix === 'sk_') {
      bearerPrincipal = { type: 'apiKey', apiKey: key, organizationId: organizationId, env }
    }
    else {
      throw new AgentViewError("Invalid API Key. The API Key must have pk_ or sk_ prefix.", 401);
    }
  }

  return bearerPrincipal;
}

export async function authnAllowUser(headers: Headers): Promise<ServicePrincipal | PrivatePrincipal | UserPrincipal> {
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

      if (action.action === "end-user:read" && (
        action.user.space === 'production' ||
        (action.user.space === 'playground' && (action.user.ownerId === memberId || action.user.shared))
      )) {
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
