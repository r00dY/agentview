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
    metadata?: any;//z.ZodType; // TODO: fix this
    items: SessionItemType[];
}

export type BaseConfig = {
    agents?: BaseAgentConfig<BaseSessionItemConfig<BaseScoreConfig>>[],
}
