import { endUsers } from './schemas/schema'
import { eq, and } from 'drizzle-orm'
import type { Transaction } from './types'
import type { Environment, Space } from 'agentview/apiTypes'
import { AgentViewError } from 'agentview'
import { requireEnvironment } from './environments'
import { randomBytes } from 'crypto'
import { authorize, type Principal } from './authMiddleware'

type FindUserByIdOptions = {
  id: string
}

type FindUserByExternalIdOptions = {
  externalId: string,
  organizationId: string,
}

type FindUserByTokenOptions = {
  token: string
}

type FindUserByEmailOptions = {
  email: string,
  organizationId: string,
}

export async function findUser(tx: Transaction, args: FindUserByIdOptions | FindUserByExternalIdOptions | FindUserByTokenOptions | FindUserByEmailOptions) {
  if ('id' in args) {
    return await tx.query.endUsers.findFirst({
      where: eq(endUsers.id, args.id),
    });
  }

  if ('externalId' in args) {
    return await tx.query.endUsers.findFirst({
      where: and(
        eq(endUsers.externalId, args.externalId),
        eq(endUsers.organizationId, args.organizationId)
      ),
    });
  }

  if ('token' in args) {
    return await tx.query.endUsers.findFirst({
      where: eq(endUsers.token, args.token), // fixme: this is terrible
    });
  }

  if ('email' in args) {
    return await tx.query.endUsers.findFirst({
      where: and(
        eq(endUsers.email, args.email),
        eq(endUsers.organizationId, args.organizationId)
      ),
    });
  }

  return undefined;
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

export async function createUser(tx: Transaction, principal: Principal, space_: Space | undefined | null, createdBy_: string | null | undefined, externalId?: string | null, email?: string | null) {
  const environment = await requireEnvironment(tx, principal.env)

  if (space_ && space_ === 'playground' && createdBy_ !== null) {
    throw new AgentViewError('Users in playground space must have "createdBy" set.', 400)
  }

  const { space, createdBy } = space_ ? { space: space_, createdBy: createdBy_ ?? null } : getDefaultSpaceFromEnvironment(environment);

  await authorize(principal, { action: "end-user:create", space })

  if (externalId) {
    const existingUserWithExternalId = await findUser(tx, { externalId, organizationId: principal.organizationId })
    if (existingUserWithExternalId) {
      throw new AgentViewError('User with this external ID already exists', 422)
    }
  }

  if (space === 'production' && createdBy !== null) { // sanity check
    throw new AgentViewError('Users in production space can be created only with production api key.', 401)
  }
  if ((space === 'playground' || space === 'shared-playground') && createdBy === null) {
    throw new AgentViewError(`Users in '${space}' space can't be created with production api key, only via member login.`, 401)
  }

  const [newEndUser] = await tx.insert(endUsers).values({
    organizationId: principal.organizationId,
    externalId,
    email,
    createdBy,
    space,
    token: randomBytes(32).toString('hex'),
  }).returning()

  return newEndUser
}