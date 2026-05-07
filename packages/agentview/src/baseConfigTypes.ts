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
    output: TSessionItemConfig[];
    scores?: TScoreConfig[];
    metadata?: Metadata | undefined;
    allowUnknownMetadata?: boolean;
    validateOutput?: boolean;
    idleTimeout?: number;
}

export interface ExternalChannelConfig {
    type: 'gmail' | 'mock' | 'resend';
    address: string;
    metadata?: Record<string, any>;
    initialState?: any;
}

export type BaseChannelConfig = ExternalChannelConfig;

export interface SharedAgentConfig {
    name: string;
    version: string;

    metadata?: Metadata | undefined;
    allowUnknownMetadata?: boolean;

    url?: string;
    adapter?: 'agentview' | 'ai-sdk';

    channels?: BaseChannelConfig[];
}

export interface BaseAgentConfig<TRunConfig extends BaseRunConfig = BaseRunConfig> extends SharedAgentConfig {
    runs?: TRunConfig[];
}


export type InternalConfig = {
    disableSummaries?: boolean;
}

export type BaseAgentViewConfig<TAgentConfig extends BaseAgentConfig = BaseAgentConfig> = {
    agents?: TAgentConfig[],
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



function baseRunSchema<T extends z.ZodType>(jsonSchemaSchema: T) {
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

    return z.object({
        input: BaseSessionItemConfigSchema,
        output: z.array(BaseSessionItemConfigSchemaWithTools),
        scores: z.array(z.object({
            name: z.string(),
            schema: jsonSchemaSchema,
        })).optional(),
        validateOutput: z.boolean().optional(),
        metadata: z.record(z.string(), jsonSchemaSchema).optional(),
        allowUnknownMetadata: z.boolean().optional(),
        idleTimeout: z.number().optional(),
    })
}



function baseConfigSchema<T extends z.ZodType>(jsonSchemaSchema: T) {
    const externalChannelSchema = z.object({
        type: z.union([z.literal('gmail'), z.literal('mock')]),
        address: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        initialState: z.any().optional(),
    });

    return z.object({
        agents: z.array(z.object({
            name: z.string(),
            version: z.string(),
            url: z.string().optional(),
            adapter: z.enum(['agentview', 'ai-sdk']).optional(),
            runs: z.array(baseRunSchema(jsonSchemaSchema)).optional(),
            channels: z.array(externalChannelSchema).optional(),
            metadata: z.record(z.string(), jsonSchemaSchema).optional(),
            allowUnknownMetadata: z.boolean().optional(),
            
        })).optional(),
        webhookUrl: z.string().optional(),
        __internal: z.object({
            disableSummaries: z.boolean().optional(),
        }).optional(),
    })
}

export const BaseRunSchema = baseRunSchema(JsonSchema)
export const BaseRunSchemaToZod = baseRunSchema(JsonSchemaToZod)
export const BaseRunSchemaZodToJsonSchema = baseRunSchema(ZodToJsonSchema)

export const BaseConfigSchema = baseConfigSchema(JsonSchema)
export const BaseConfigSchemaToZod = baseConfigSchema(JsonSchemaToZod)
export const BaseConfigSchemaZodToJsonSchema = baseConfigSchema(ZodToJsonSchema)

function isJSONSchema(value: any): boolean { // temporarily simple check
    return typeof value === 'object' && value !== null && '$schema' in value;
}



// /**
//  * ai-sdk
//  */

// export interface AISDKAgentConfig {
//     name: string;
//     version: string;

//     metadata?: Metadata | undefined;
//     allowUnknownMetadata?: boolean;

//     url?: string;

//     channels?: BaseChannelConfig[];

//     // custom fields for ai-sdk
//     userMessage: {}
//     assistantMessage: {
//         parts: Array<{
//             type: string,
//             // scores?: BaseScoreConfig[] // - we do not support scores for items now
//         }>,
//         scores?: BaseScoreConfig[];
//     }
// }