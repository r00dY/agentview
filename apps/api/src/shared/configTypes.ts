import { z } from "zod";

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

export interface BaseAgentConfig<TSessionItem> {
    name: string;
    url: string;
    context?: z.ZodTypeAny;
    items: TSessionItem[];
}

export type BaseConfig = {
    agents?: BaseAgentConfig<BaseSessionItemConfig<BaseScoreConfig>>[],
}
