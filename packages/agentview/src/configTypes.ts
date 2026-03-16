import { z } from "zod";

export interface BaseScoreConfig {
    name: string;
    schema: z.ZodType;
}

export type Metadata = Record<string, z.ZodType>;

export interface BaseSessionItemConfig<TScoreConfig extends BaseScoreConfig = BaseScoreConfig> {
    schema: z.ZodType;
    scores?: TScoreConfig[];
    callResult?: BaseSessionItemConfig<TScoreConfig>;
}

export interface BaseRunConfig<TSessionItemConfig extends BaseSessionItemConfig = BaseSessionItemConfig, TSessionInputItemConfig extends BaseSessionItemConfig = BaseSessionItemConfig, TScoreConfig extends BaseScoreConfig = BaseScoreConfig> {
    input: TSessionInputItemConfig;
    output: TSessionItemConfig;
    steps?: TSessionItemConfig[];
    scores?: TScoreConfig[];
    metadata?: Metadata | undefined;
    allowUnknownMetadata?: boolean;
    validateSteps?: boolean;
    idleTimeout?: number;
}

export interface BaseAgentConfig<TRunConfig extends BaseRunConfig = BaseRunConfig> {
    name: string;
    version: string;
    url?: string;
    adapter?: 'agentview' | 'ai-sdk';
    runs?: TRunConfig[];
}

export interface ApiChannelConfig {
    type: 'api';
    name: string;
    agent: string;
    metadata?: Metadata | undefined;
    allowUnknownMetadata?: boolean;
}

export interface ExternalChannelConfig {
    type: 'gmail' | 'mock';
    address: string;
    agent?: string | { name: string; initialState?: any };
}

export type BaseChannelConfig = ApiChannelConfig | ExternalChannelConfig;

export type InternalConfig = {
    disableSummaries?: boolean;
}

export type BaseAgentViewConfig<TAgentConfig extends BaseAgentConfig = BaseAgentConfig, TChannelConfig extends BaseChannelConfig = BaseChannelConfig> = {
    agents?: TAgentConfig[],
    channels?: TChannelConfig[],
    webhookUrl?: string,
    __internal?: InternalConfig,
}