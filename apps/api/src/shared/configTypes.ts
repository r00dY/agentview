import { z } from "zod";

export interface BaseScoreConfig {
    name: string;
    schema: z.ZodType;
    options?: any
}

export interface BaseSessionItemConfig<ScoreConfigType> {
    type: string;
    role?: string;
    content: z.ZodType;
    scores?: ScoreConfigType[];
}

export interface BaseAgentConfig<SessionItemType> {
    name: string;
    url: string;
    context?: z.ZodType;
    items: SessionItemType[];
}

export type BaseConfig = {
    agents?: BaseAgentConfig<BaseSessionItemConfig<BaseScoreConfig>>[],
}
