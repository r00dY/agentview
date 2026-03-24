import { z } from "zod";
import { convertJsonSchemaToZod } from '@agentview/zod-from-json-schema';

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

const JsonSchema = z.record(z.string(), z.any()).refine((value) => isJSONSchema(value), {
    message: "Invalid JSON Schema format",
});

const JsonSchemaToZod = JsonSchema.transform((schema) => convertJsonSchemaToZod(schema))

const ZodToJsonSchema = z.any()
    .refine((value) => {
        try {
            z.toJSONSchema(value);
            return true;
        }
        catch (error) {
            return false;
        }
    }, {
        message: "must be correct Zod schema",
    })
    .transform((schema) => z.toJSONSchema(schema))


function baseConfigSchema<T extends z.ZodType>(jsonSchemaSchema: T) {
    const BaseSessionItemConfigSchema = z.object({
        schema: jsonSchemaSchema,
        scores: z.array(z.object({
            name: z.string(),
            schema: jsonSchemaSchema,
        })).optional(),
    });

    const BaseSessionItemConfigSchemaWithTools = BaseSessionItemConfigSchema.extend({
        callResult: BaseSessionItemConfigSchema.optional(),
    });

    const apiChannelSchema = z.object({
        type: z.literal('api'),
        name: z.string(),
        agent: z.string(),
        metadata: z.record(z.string(), jsonSchemaSchema).optional(),
        allowUnknownMetadata: z.boolean().optional(),
    });

    const externalChannelSchema = z.object({
        type: z.union([z.literal('gmail'), z.literal('mock')]),
        address: z.string(),
        agent: z.union([z.string(), z.object({ name: z.string(), initialState: z.any().optional() })]),
    });

    const channelSchema = z.discriminatedUnion('type', [apiChannelSchema, externalChannelSchema]);

    return z.object({
        agents: z.array(z.object({
            name: z.string(),
            version: z.string(),
            url: z.string().optional(),
            adapter: z.enum(['agentview', 'ai-sdk']).optional(),
            runs: z.array(z.object({
                input: BaseSessionItemConfigSchema,
                output: BaseSessionItemConfigSchema,
                steps: z.array(BaseSessionItemConfigSchemaWithTools).optional(),
                scores: z.array(z.object({
                    name: z.string(),
                    schema: jsonSchemaSchema,
                })).optional(),
                validateSteps: z.boolean().optional(),
                metadata: z.record(z.string(), jsonSchemaSchema).optional(),
                allowUnknownMetadata: z.boolean().optional(),
                idleTimeout: z.number().optional(),
            })).optional(),
        })).optional(),
        channels: z.array(channelSchema).optional(),
        webhookUrl: z.string().optional(),
        __internal: z.object({
            disableSummaries: z.boolean().optional(),
        }).optional(),
    })
}

export const BaseConfigSchema = baseConfigSchema(JsonSchema)
export const BaseConfigSchemaToZod = baseConfigSchema(JsonSchemaToZod)
export const BaseConfigSchemaZodToJsonSchema = baseConfigSchema(ZodToJsonSchema)

function isJSONSchema(value: any): boolean { // temporarily simple check
    return typeof value === 'object' && value !== null && '$schema' in value;
}
