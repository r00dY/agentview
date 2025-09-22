import { db } from "./db";
import { configs } from "./schemas/schema";
import { desc } from "drizzle-orm";
import { convertJsonSchemaToZod } from 'zod-from-json-schema';
import type { BaseConfig } from "./shared/configTypes";

function parseConfig(config: any): BaseConfig {
    return {
        sessions: config.sessions.map((session: any) => ({
            type: session.type,
            url: session.url,
            metadata: session.metadata ? convertJsonSchemaToZod(session.metadata) : undefined,
            items: session.items?.map((item: any) => ({
                ...item,
                content: convertJsonSchemaToZod(item.content),
                scores: item.scores?.map((score: any) => ({
                    ...score,
                    schema: convertJsonSchemaToZod(score.schema),
                }))
            }))
        }))
    }
}

export async function getConfig() {
  const configRows = await db.select().from(configs).orderBy(desc(configs.createdAt)).limit(1)
  if (configRows.length === 0) {
    return undefined;
  }

  return parseConfig(configRows[0].config)
}