import { environments } from "./schemas/schema";
import { eq, isNull, and } from "drizzle-orm";
import type { Transaction } from "./types";
import { HTTPException } from "hono/http-exception";
import { BaseConfigSchemaToZod } from "agentview/configUtils";
import type { Environment } from "agentview/apiTypes";
import { db__dangerous } from "./db";

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
export async function getEnvironment(tx: Transaction, envHandle?: string) { // envId is actually either null (production) or user id (user's dev environment). For now!
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

export async function requireEnvironment(tx: Transaction, envHandle?: string) {
  const environment = await getEnvironment(tx, envHandle);
  if (!environment) {
    throw new HTTPException(404, { message: "Environment not found" });
  }
  return environment;
}

export function getConfigFromEnvironment(environment: Environment) {
  return BaseConfigSchemaToZod.parse(environment.config)
}

export async function createEnvironment(orgId: string, envHandle: string, userId: string | null) {
  await db__dangerous.insert(environments).values({
    handle: envHandle,
    organizationId: orgId,
    userId: userId,
    config: null,
  })
}