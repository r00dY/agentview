import { z } from "zod";


export const BaseSessionItemConfigSchema = z.object({
    type: z.string(),
    role: z.string().optional(),
    content: z.any(),
    scores: z.array(z.object({
        name: z.string(),
        schema: z.any(),
    })).optional(),
})

export const BaseConfigSchema = z.object({
    agents: z.array(z.object({
        name: z.string(),
        url: z.string(),
        context: z.any().nullable(),
        runs: z.array(z.object({
            input: BaseSessionItemConfigSchema,
            output: BaseSessionItemConfigSchema,
            steps: z.array(BaseSessionItemConfigSchema).nullable(),
        })),
    })).optional(),
})

export interface BaseScoreConfig {
    name: string;
    schema: z.ZodType;
    options?: any
}

export interface BaseSessionItemConfig<TScoreConfig> {
    type: string;
    role?: string;
    content: z.ZodType;
    scores?: TScoreConfig[];
}

export interface BaseRunConfig<TSessionItemConfig> {
    input: TSessionItemConfig;
    output: TSessionItemConfig;
    steps?: TSessionItemConfig[];
}

export interface BaseAgentConfig<TRunConfig> {
    name: string;
    url: string;
    context?: z.ZodTypeAny;
    runs: TRunConfig[];
}

export type BaseConfig = {
    agents?: BaseAgentConfig<BaseRunConfig<BaseSessionItemConfig<BaseScoreConfig>>>[],
}
