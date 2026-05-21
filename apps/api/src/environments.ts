import type { Environment } from "agentview/apiTypes";
import { BaseConfigSchemaToZod, type BaseAgentViewConfig } from "agentview/baseConfigTypes";
import { and, eq } from "drizzle-orm";
import { db__dangerous } from "./db";
import { environments } from "./schemas/schema";
import type { TenantTransaction } from "./withOrg";
import { AgentViewError } from "agentview";

// export type ProdEnv = {
//     type: 'prod'
// }

// export type DevEnv = {
//     type: 'dev',
//     memberId: string
// }

// export type Env = ProdEnv | DevEnv;



// export async function getEnvironmentByHandle(tx: TenantTransaction, envHandle: string) {
//   const environment = await tx.query.environments.findFirst({
//     columns: {
//       id: true,
//       handle: true,
//       createdAt: true,
//       config: true,
//       tunnelUrl: true,
//       userId: true,
//     },
//     with: {
//       user: true,
//     },
//     where: eq(environments.handle, envHandle),
//   });

//   return environment ?? undefined;
// }

export async function getEnvironmentByHandleAndOrgId(orgId: string, envHandle: string) {
  return await db__dangerous.query.environments.findFirst({
    columns: {
      id: true,
      handle: true,
      createdAt: true,
      config: true,
      tunnelUrl: true,
      userId: true,
    },
    with: {
      user: true,
    },
    where: and(eq(environments.handle, envHandle), eq(environments.organizationId, orgId)),
  });
}

export async function getEnvironment(tx: TenantTransaction) { // envId is actually either null (production) or user id (user's dev environment). For now!
  const envHandle = tx.principal.env;

  if (!envHandle) {
    return undefined;
  }

  const environment = await tx.query.environments.findFirst({
    columns: {
      id: true,
      handle: true,
      createdAt: true,
      config: true,
      tunnelUrl: true,
      userId: true,
    },
    with: {
      user: true,
    },
    where: eq(environments.handle, envHandle),
  });

  return environment ?? undefined;
}

export async function requireEnvironment(tx: TenantTransaction) {
  if (!tx.principal.env) {
    throw new AgentViewError("You must provide X-Env header", 400);
  }
  
  const environment = await getEnvironment(tx);
  if (!environment) {
    throw new AgentViewError("Environment not found", 404);
  }
  return environment;
}

export async function createEnvironment(orgId: string, envHandle: string, userId: string | null) {
  await db__dangerous.insert(environments).values({
    handle: envHandle,
    organizationId: orgId,
    userId: userId,
    config: null,
  })
}

export function getConfigFromEnvironment(environment: Pick<Environment, 'config'>) {
  return BaseConfigSchemaToZod.parse(environment.config)
}

export async function requireConfig(tx: TenantTransaction): Promise<BaseAgentViewConfig> {
  const environment = await requireEnvironment(tx);
  if (environment.config === null) {
    throw new AgentViewError(`Environment "${environment.handle}" has no config.`, 400);
  }
  return getConfigFromEnvironment(environment)
}
