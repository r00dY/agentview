import { z } from "zod";

export interface BaseScoreConfig {
    name: string;
    schema: z.ZodType;
    options?: any
}

export interface BaseActivityConfig<ScoreConfigType> {
    type: string;
    role: string;
    content: z.ZodType;
    scores?: ScoreConfigType[];
}

export interface BaseThreadConfig<ActivityType> {
    type: string;
    url: string;
    metadata?: any;//z.ZodType; // TODO: fix this
    activities: ActivityType[];
}

export type BaseConfig = {
    threads: BaseThreadConfig<BaseActivityConfig<BaseScoreConfig>>[],
}
