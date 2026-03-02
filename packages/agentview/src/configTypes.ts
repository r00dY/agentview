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

export interface BaseRunConfig<TSessionItemConfig extends BaseSessionItemConfig = BaseSessionItemConfig, TSessionInputItemConfig extends BaseSessionItemConfig = BaseSessionItemConfig> {
    input: TSessionInputItemConfig;
    output: TSessionItemConfig;
    steps?: TSessionItemConfig[];
    metadata?: Metadata | undefined;
    allowUnknownMetadata?: boolean;
    validateSteps?: boolean;
    idleTimeout?: number;
}

export interface BaseAgentConfig<TRunConfig extends BaseRunConfig = BaseRunConfig> {
    name: string;
    url?: string;
    protocol?: 'default' | 'ai-sdk';
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
    agent: string;
}

export type BaseChannelConfig = ApiChannelConfig | ExternalChannelConfig;

export type InternalConfig = {
    disableSummaries?: boolean;
}

export type BaseAgentViewConfig<TAgentConfig extends BaseAgentConfig = BaseAgentConfig> = {
    agents?: TAgentConfig[],
    channels?: BaseChannelConfig[],
    webhookUrl?: string,
    __internal?: InternalConfig,
}