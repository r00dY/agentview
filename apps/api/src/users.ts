import { endUsers } from './schemas/schema'
import { eq, and, sql } from 'drizzle-orm'
import type { Transaction } from './types'
import type { Environment, Space, UserCreate } from 'agentview/apiTypes'
import { AgentViewError } from 'agentview'
import { requireEnvironment } from './environments'
import { randomBytes } from 'crypto'
import { authorize, type Principal } from './authMiddleware'
import type { OrgTransaction, TenantTransaction } from './withOrg'
import { requireUUID } from './isUUID'

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
    return await tx.query.endUsers.findFirst({
      where: eq(endUsers.token, args.token),
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



function getDefaultSpaceFromEnvironment(environment: Environment): { space: Space, createdBy: string | null } {
  if (environment.handle === 'production') {
    return {
      space: 'production',
      createdBy: null,
    }
  }
  else if (environment.handle.startsWith('dev:')) {
    return {
      space: 'playground',
      createdBy: environment.user!.id as string,
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
  await tx.acquireLock({ type: "create_resource" });

  const environment = await requireEnvironment(tx)

  if (body.space && body.space === 'playground' && body.createdBy !== null) {
    throw new AgentViewError('Users in playground space must have "createdBy" set.', 400)
  }

  const { space, createdBy } = body.space ? { space: body.space, createdBy: body.createdBy ?? null } : getDefaultSpaceFromEnvironment(environment);

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
    createdBy,
    space,
    token: randomBytes(32).toString('hex'),
  }).returning()

  return newEndUser
}


/**
 * Serialized "ensureUser" for specific email.
 * - if called by 2+ concurrent requests, one will create the user, the other will return the existing user.
 * - it's "check-lock-check" pattern (fast path without lock, slow path with lock)
 * 
 * The space is automatically determined based on the environment.
 */
export async function ensureUserForEmail(tx: TenantTransaction, email: string) {
  const user = await findUser(tx, { email }) // check (no lock)
  if (user) {
    return user
  }

  await tx.acquireLock({ type: "create_resource" });
  const user2 = await findUser(tx, { email }) // check
  if (user2) {
    return user2
  }

  return await createUser(tx, { email })
}


export async function updateUser(tx: TenantTransaction, id: string, body: UserCreate) {
  await tx.acquireLock({ type: "create_resource" }); // this is actually "edit" but we treat 'create_resource' as general fallback lock

  const user = await requireUser(tx, { id })
  await authorize(tx.principal, { action: "end-user:update", user })

  const [updatedUser] = await tx.update(endUsers).set(body).where(eq(endUsers.id, id)).returning();
  return updatedUser
}