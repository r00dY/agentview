import type { Environment } from "agentview/apiTypes";
import { BaseConfigSchemaToZod, type BaseAgentViewConfig } from "agentview/baseConfigTypes";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db__dangerous } from "./db";
import { environments } from "./schemas/schema";
import type { TenantTransaction } from "./withOrg";

// export type ProdEnv = {
//     type: 'prod'
// }

// export type DevEnv = {
//     type: 'dev',
//     memberId: string
// }

// export type Env = ProdEnv | DevEnv;


/**
 * Get config row for a user.
 * - userId = null: production config (shared across org)
 * - userId = string: user's development config
 */
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
    },
    with: {
      user: true,
    },
    where: eq(environments.handle, envHandle),
  });

  return environment ?? undefined;
}

export async function requireEnvironment(tx: TenantTransaction) {
  const environment = await getEnvironment(tx);
  if (!environment) {
    throw new HTTPException(404, { message: "Environment not found" });
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

export function getConfigFromEnvironment(environment: Environment) {
  return BaseConfigSchemaToZod.parse(environment.config)
}

export async function requireConfig(tx: TenantTransaction): Promise<BaseAgentViewConfig> {
  const environment = await requireEnvironment(tx);
  if (environment.config === null) {
    throw new HTTPException(400, { message: "Environment has no config." });
  }
  return getConfigFromEnvironment(environment)
}
