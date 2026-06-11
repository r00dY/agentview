import { AgentViewError } from 'agentview'
import type { Environment, Space, UserCreate, UserUpdate } from 'agentview/apiTypes'
import { randomBytes } from 'crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { authorize } from './authMiddleware'
import { getEnvironment, requireEnvironment } from './environments'
import { requireUUID } from './isUUID'
import { log } from './logger'
import { endUsers, endUserTokens } from './schemas/schema'
import type { OrgTransaction, TenantTransaction } from './withOrg'

type FindUserByIdOptions = {
  id: string
}

type FindUserByTokenOptions = {
  token: string
}

type FindUserByExternalIdOptions = {
  externalId: string,
}

type FindUserByEmailOptions = {
  email: string,
}


export async function findUser(tx: OrgTransaction, args: FindUserByIdOptions | FindUserByExternalIdOptions | FindUserByTokenOptions | FindUserByEmailOptions) {
  if ('id' in args) {
    requireUUID(args.id);
    return await tx.query.endUsers.findFirst({
      where: and(
        eq(endUsers.id, args.id),
      ),
    });
  }

  if ('externalId' in args) {
    return await tx.query.endUsers.findFirst({
      where: and(
        eq(endUsers.externalId, args.externalId),
      ),
    });
  }

  if ('token' in args) {
    const tokenRow = await tx.query.endUserTokens.findFirst({
      where: and(
        eq(endUserTokens.token, args.token),
        isNull(endUserTokens.revokedAt),
      ),
    });
    if (!tokenRow) return undefined;
    return await tx.query.endUsers.findFirst({
      where: eq(endUsers.id, tokenRow.userId),
    });
  }

  if ('email' in args) {
    return await tx.query.endUsers.findFirst({
      where: and(
        eq(endUsers.email, args.email),
      ),
    });
  }

  return undefined;
}

export async function requireUser(tx: OrgTransaction, arg: Parameters<typeof findUser>[1]) {
  const user = await findUser(tx, arg)
  if (!user) {
    throw new AgentViewError("End user not found", 404);
  }
  return user
}



async function getDefaultSpace(tx: TenantTransaction): Promise<{ space: Space, ownerId: string | null }> {
  // For member principal, just use logged in user's playground space as default
  if (tx.principal.type === 'member') {
    return {
      space: 'playground',
      ownerId: tx.principal.session.user.id,
    }
  }

  const environment = await getEnvironment(tx)

  if (!environment) {
    throw new AgentViewError("Can't establish default space for the user (no environment found).", 400)
  }

  if (environment.handle === 'production') {
    return {
      space: 'production',
      ownerId: null,
    }
  }
  else if (environment.handle.startsWith('local-')) {
    return {
      space: 'playground',
      ownerId: environment.user!.id as string,
    }
  }
  else {
    throw new AgentViewError('Invalid environment handle', 400)
  }
}

/**
 * Mutations. Locks required.
 */
  
export async function createUser(tx: TenantTransaction, body: UserCreate) {
  // await tx.acquireLock({ type: "create_resource" });

  if (body.space && body.space === 'playground' && body.ownerId === null) {
    throw new AgentViewError('Users in playground space must have "ownerId" set.', 400)
  }

  if (body.space === 'production' && body.shared) {
    throw new AgentViewError('Users in production space cannot be marked as "shared".', 400)
  }

  const { space, ownerId } = body.space ? { space: body.space, ownerId: body.ownerId ?? null } : await getDefaultSpace(tx);
  const shared = space === 'production' ? false : (body.shared ?? false);

  await authorize(tx.principal, { action: "end-user:create", space })

  if (body.externalId) {
    const existingUserWithExternalId = await findUser(tx, { externalId: body.externalId })
    if (existingUserWithExternalId) {
      throw new AgentViewError('User with this external ID already exists', 422)
    }
  }
  if (body.email) {
    const existingUserWithEmail = await findUser(tx, { email: body.email })
    if (existingUserWithEmail) {
      throw new AgentViewError('User with this email already exists', 422)
    }
  }

  const [newEndUser] = await tx.insert(endUsers).values({
    organizationId: tx.organizationId,
    externalId: body.externalId,
    email: body.email,
    name: body.name,
    headline: body.headline,
    details: body.details,
    ownerId,
    space,
    shared,
  }).returning()

  const { token } = await issueToken(tx, newEndUser.id);

  log.info({
    userId: newEndUser.id,
    space,
    hasExternalId: !!body.externalId,
    hasEmail: !!body.email,
  }, 'user created');

  return { token, user: newEndUser }
}

/**
 * Issues a new token for a user. The token string is only returned at issue time.
 */
export async function issueToken(tx: OrgTransaction, userId: string) {
  const [row] = await tx.insert(endUserTokens).values({
    organizationId: tx.organizationId,
    userId,
    token: randomBytes(32).toString('hex'),
  }).returning()
  log.info({ userId, tokenId: row.id }, 'user token issued');
  return row
}

export async function listTokens(tx: OrgTransaction, userId: string) {
  return await tx.query.endUserTokens.findMany({
    where: eq(endUserTokens.userId, userId),
    orderBy: [desc(endUserTokens.createdAt)],
    columns: {
      id: true,
      userId: true,
      createdAt: true,
      revokedAt: true,
    },
  })
}

export async function revokeToken(tx: OrgTransaction, tokenId: string) {
  requireUUID(tokenId);
  const existing = await tx.query.endUserTokens.findFirst({
    where: eq(endUserTokens.id, tokenId),
  });
  if (!existing) {
    throw new AgentViewError("Token not found", 404);
  }
  if (existing.revokedAt) {
    return existing;
  }
  const [row] = await tx.update(endUserTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(endUserTokens.id, tokenId))
    .returning();
  log.info({ userId: existing.userId, tokenId }, 'user token revoked');
  return row;
}

export async function requireTokenOwner(tx: OrgTransaction, tokenId: string) {
  requireUUID(tokenId);
  const token = await tx.query.endUserTokens.findFirst({
    where: eq(endUserTokens.id, tokenId),
  });
  if (!token) {
    throw new AgentViewError("Token not found", 404);
  }
  const user = await requireUser(tx, { id: token.userId });
  return { token, user };
}


// /**
//  * Serialized "ensureUser" for specific email.
//  * - if called by 2+ concurrent requests, one will create the user, the other will return the existing user.
//  * - it's "check-lock-check" pattern (fast path without lock, slow path with lock)
//  * 
//  * The space is automatically determined based on the environment.
//  */
// export async function ensureUserForEmail(tx: TenantTransaction, email: string) {
//   const user = await findUser(tx, { email }) // check (no lock)
//   if (user) {
//     return user
//   }

//   await tx.acquireLock({ type: "create_resource" });
//   const user2 = await findUser(tx, { email }) // check
//   if (user2) {
//     return user2
//   }

//   const result = await createUser(tx, { email })
//   return result.user;
// }


export async function updateUser(tx: TenantTransaction, id: string, body: UserUpdate) {
  // await tx.acquireLock({ type: "create_resource" }); // this is actually "edit" but we treat 'create_resource' as general fallback lock

  const user = await requireUser(tx, { id })
  await authorize(tx.principal, { action: "end-user:update", user })

  if (user.space === 'production' && body.shared) {
    throw new AgentViewError('Users in production space cannot be marked as "shared".', 400)
  }

  const [updatedUser] = await tx.update(endUsers).set(body).where(eq(endUsers.id, id)).returning();
  log.info({ userId: id, updatedFields: Object.keys(body) }, 'user updated');
  return updatedUser
}