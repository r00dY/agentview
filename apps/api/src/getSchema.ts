import { db } from "./db";
import { schemas } from "./db/schema";
import { desc } from "drizzle-orm";
import { convertJsonSchemaToZod } from 'zod-from-json-schema';
import type { BaseConfig } from "./shared/configTypes";

export async function getSchema() {
  const schemaRows = await db.select().from(schemas).orderBy(desc(schemas.createdAt)).limit(1)
  if (schemaRows.length === 0) {
    return undefined;
  }

  const schemaAsObject = JSON.parse(schemaRows[0].schema as any, (key, value) => {
    if (key === "schema" || key === "metadata") {
      return convertJsonSchemaToZod(value)
    }
    return value
  })

  return schemaAsObject as BaseConfig
}