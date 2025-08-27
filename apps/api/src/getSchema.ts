import { db } from "./db";
import { schemas } from "./db/schema";
import { desc } from "drizzle-orm";
import { convertJsonSchemaToZod } from 'zod-from-json-schema';
import type { BaseConfig } from "./shared/configTypes";

function parseSchema(schema: any): BaseConfig {
    console.log('parseSchema', schema)
    return {
        threads: schema.threads.map((thread: any) => ({
            type: thread.type,
            metadata: thread.metadata ? convertJsonSchemaToZod(thread.metadata) : undefined,
            activities: thread.activities?.map((activity: any) => ({
                ...activity,
                content: convertJsonSchemaToZod(activity.content),
                scores: activity.scores?.map((score: any) => ({
                    ...score,
                    schema: convertJsonSchemaToZod(score.schema),
                }))
            }))
        }))
    }
}


export async function getSchema() {
  const schemaRows = await db.select().from(schemas).orderBy(desc(schemas.createdAt)).limit(1)
  if (schemaRows.length === 0) {
    return undefined;
  }

  return parseSchema(schemaRows[0].schema)
}