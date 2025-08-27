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
    metadata?: z.ZodType;
    activities: ActivityType[];
}

export type BaseConfig = {
    threads: BaseThreadConfig<BaseActivityConfig<BaseScoreConfig>>[],
}
