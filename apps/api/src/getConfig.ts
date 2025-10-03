import { db } from "./db";
import { configs } from "./schemas/schema";
import { desc } from "drizzle-orm";
import { convertJsonSchemaToZod } from 'zod-from-json-schema';
import type { BaseConfig, BaseConfigSchema, BaseScoreConfig, BaseSessionItemConfig, BaseSessionItemConfigSchema } from "./shared/configTypes";
import { z } from "zod";

function parseConfig(config: z.infer<typeof BaseConfigSchema>): BaseConfig {
    return {
        agents: config.agents?.map(agent => ({
            name: agent.name,
            url: agent.url,
            context: agent.context ? convertJsonSchemaToZod(agent.context) : undefined,
            runs: agent.runs?.map((item) => ({
                input: parseSessionItem(item.input),
                output: parseSessionItem(item.output),
                steps: item.steps?.map(parseSessionItem),
            }))
        }))
    }
}

function parseSessionItem(item: z.infer<typeof BaseSessionItemConfigSchema>): BaseSessionItemConfig<BaseScoreConfig> {
    return {
        type: item.type,
        role: item.role,
        content: convertJsonSchemaToZod(item.content),
        scores: item.scores?.map((score: any) => ({
            ...score,
            schema: convertJsonSchemaToZod(score.schema),
        }))
    }
}

export async function getConfig() {
  const configRows = await db.select().from(configs).orderBy(desc(configs.createdAt)).limit(1)
  if (configRows.length === 0) {
    return undefined;
  }

  return parseConfig(configRows[0].config as z.infer<typeof BaseConfigSchema>)
}