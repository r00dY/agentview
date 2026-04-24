import type { SessionItem, ChannelRef, SessionBase } from "./apiTypes.js";
import type { BaseAgentViewConfig, BaseAgentConfig, BaseChannelConfig, BaseSessionItemConfig, BaseRunConfig } from "./baseConfigTypes.js";
import { BaseConfigSchemaZodToJsonSchema, BaseRunSchemaZodToJsonSchema } from "./baseConfigTypes.js";
import { z } from "zod";
import { AgentViewError } from "./AgentViewError.js";


// Register `callId` meta for zod schemas
declare module "zod" {
    interface GlobalMeta {
        callId?: boolean;
    }
}

z.string().register(z.globalRegistry, {
    callId: true
});



export function findAgentConfig<T extends BaseAgentViewConfig>(config: T, agentName: string): NonNullable<T["agents"]>[number] | undefined {
    return config.agents?.find((agent) => agent.name === agentName);
}

export function requireAgentConfigByName<T extends BaseAgentViewConfig>(config: T, agentName: string): NonNullable<T["agents"]>[number] {
    const agentConfig = findAgentConfig(config, agentName);
    if (!agentConfig) {
        throw new AgentViewError(`Agent config not found for agent '${agentName}'`, 404);
    }
    return agentConfig;
}

export function findAgentConfigBySession<T extends BaseAgentViewConfig>(config: T, session: SessionBase): NonNullable<T["agents"]>[number] | undefined {
    if (!session.agentRef) {
        return;
    }

    return findAgentConfig(config, session.agentRef.agent);
}

export function requireAgentConfigBySession<T extends BaseAgentViewConfig>(config: T, session: SessionBase): NonNullable<T["agents"]>[number] {
    const agentConfig = findAgentConfigBySession(config, session);
    if (!agentConfig) {
        throw new AgentViewError(`Agent config not found for session '${session.id}'`, 404);
    }
    return agentConfig;
}









function findMatchingRunConfigs<T extends BaseAgentConfig>(agentConfig: T, inputItemContent: any) {
    let matchingRunConfigs: NonNullable<T["runs"]>[number][] = [];

    for (const runConfig of agentConfig.runs ?? []) {
        if (runConfig.input.schema.safeParse(inputItemContent).success) {
            matchingRunConfigs.push(runConfig);
        }
    }

    return matchingRunConfigs;
}

export function findRunConfig<T extends BaseAgentConfig>(agentConfig: T, inputItemContent: any): NonNullable<T["runs"]>[number] | undefined {
    const matchingRunConfigs = findMatchingRunConfigs(agentConfig, inputItemContent);
    if (matchingRunConfigs.length === 0) {
        return;
    }
    else if (matchingRunConfigs.length > 1) {
        return;
    }
    return matchingRunConfigs[0];
}

export function requireRunConfig<T extends BaseAgentConfig>(agentConfig: T, inputItemContent: any) {
    const matchingRunConfigs = findMatchingRunConfigs(agentConfig, inputItemContent);
    if (matchingRunConfigs.length === 0) {
        throw new AgentViewError(`Incorrect input item for agent '${agentConfig.name}'.`, 422, { item: inputItemContent });
    }
    else if (matchingRunConfigs.length > 1) {
        throw new AgentViewError(`More than 1 run config found for input item item.`, 422, { item: inputItemContent });
    }

    return matchingRunConfigs[0]
}

// two possible inputs:
// - session (items history) + new item (not yet in session) -> we assume it goes last, all items are previous items
// - session (items history) + item id -> concrete item, we find it and try to find the config

// export function findItemConfigByIndex<RunT extends BaseRunConfig>(runConfig: RunT, items: any[], index: number) : { itemConfig: RunT["output"], content: any, toolCallContent?: any } | undefined {
//     const item = items[index];
//     return findItemConfig(runConfig, items, item, item.__type);
// }

type FindItemConfigResult<T extends BaseSessionItemConfig> = {
    itemConfig: T,
    content: any,
    tool?: any,
    type: "input" | "output"
}

export function findItemConfigById<RunT extends BaseRunConfig>(runConfig: RunT, sessionItems: SessionItem[], itemId: string, itemType?: "input" | "output"): FindItemConfigResult<RunT["output"][number]> | undefined {
    const itemsBefore = [];
    const itemsAfter = [];
    let newItem = undefined;
    let isBefore = true;

    for (const sessionItem of sessionItems) {
        if (sessionItem.id === itemId) {
            newItem = sessionItem.content;
            isBefore = false;
        }
        else {
            if (isBefore) {
                itemsBefore.push(sessionItem.content);
            }
            else {
                itemsAfter.push(sessionItem.content);
            }
        }
    }

    if (!newItem) {
        return undefined;
    }

    return findItemConfig(runConfig, itemsBefore, newItem, itemsAfter, itemType);
}


export function findItemConfig<RunT extends BaseRunConfig>(runConfig: RunT, itemsBefore: any[], item: Record<string, any>, itemsAfter: any[], itemType?: "input" | "output"): FindItemConfigResult<RunT["output"][number]> | undefined {
    const matches: any[] = [];

    if (!itemType || itemType === "input") {
        matches.push(...matchItemConfigs([runConfig.input], [], item, []).map((match) => ({ ...match, type: "input" })));
    }
    if (!itemType || itemType === "output") {
        matches.push(...matchItemConfigs(runConfig.output, itemsBefore, item, itemsAfter).map((match) => ({ ...match, type: "output" })));
    }

    if (matches.length === 0) {
        return undefined;
    }
    else if (matches.length > 1) {
        console.warn(`More than 1 run was matched for the item content.`);
        console.warn('Item content', item);
        console.warn('Matches', matches)
        return undefined;
    }

    return matches[0]
}


function getCallIdKey(inputSchema: z.ZodType): any | undefined {
    if (inputSchema instanceof z.ZodObject) {
        const shape = inputSchema.shape;

        for (const [key, value] of Object.entries(shape)) {
            const meta = value.meta(); // fixme: it could be any type, even without shape

            if (meta?.callId === true) {
                return key;
            }
        }
    }
    return undefined;
}


function matchItemConfigs<T extends BaseSessionItemConfig>(itemConfigs: T[], itemsBefore: any[], item: any, itemsAfter: any[]): Omit<FindItemConfigResult<T>, "type">[] {
    const matches: Omit<FindItemConfigResult<T>, "type">[] = [];

    for (const itemConfig of itemConfigs) {

        // Non-tool config
        if (!itemConfig.callResult) {
            const itemParseResult = itemConfig.schema.safeParse(item);
            if (itemParseResult.success) {
                matches.push({ itemConfig, content: itemParseResult.data });
            }
        }
        // Tool config (call or result)
        else {
            const toolCallParseResult = itemConfig.schema.safeParse(item);
            const toolResultParseResult = itemConfig.callResult.schema.safeParse(item);

            const toolCallIdKey = getCallIdKey(itemConfig.schema);
            const toolResultIdKey = getCallIdKey(itemConfig.callResult.schema);

            const hasKeys = toolCallIdKey !== undefined && toolResultIdKey !== undefined;

            // matches tool call config
            if (toolCallParseResult.success) {
                let hasResult = false;

                // let's find whether this tool call has a tool result
                if (hasKeys) {
                    for (let i = 0; i < itemsAfter.length; i++) {
                        const itemAfter = itemsAfter[i];
                        const potentialToolResultParseResult = itemConfig.callResult.schema.safeParse(itemAfter);

                        if (potentialToolResultParseResult.success && item[toolCallIdKey] === itemAfter[toolResultIdKey]) {
                            hasResult = true;
                            break;
                        }
                    }
                }

                matches.push({
                    itemConfig,
                    content: toolCallParseResult.data,
                    tool: {
                        type: "call",
                        hasResult
                    }
                })
            }

            // matches tool result config
            if (toolResultParseResult.success) {

                if (hasKeys) {
                    for (let i = itemsBefore.length - 1; i >= 0; i--) {
                        const prevItem = itemsBefore[i];
                        const potentialToolCallParseResult = itemConfig.schema.safeParse(prevItem);

                        if (potentialToolCallParseResult.success && prevItem[toolCallIdKey] === item[toolResultIdKey]) {
                            matches.push({
                                // @ts-ignore
                                itemConfig: itemConfig.callResult!,
                                content: toolResultParseResult.data,
                                tool: {
                                    type: "result",
                                    call: {
                                        itemConfig,
                                        content: potentialToolCallParseResult.data,
                                    }
                                }
                            });

                            break;
                        }
                    }
                }

            }
        }
    }

    return matches;
}

export function serializeConfig(config: any) {
    const { data, success, error } = BaseConfigSchemaZodToJsonSchema.safeParse(config);
    if (!success) {
        throw new AgentViewError("Invalid config", 422, { cause: error.issues });
    }
    return data;
}

export function serializeRunConfig(runConfig: any) {
    const { data, success, error } = BaseRunSchemaZodToJsonSchema.safeParse(runConfig);
    if (!success) {
        throw new AgentViewError("Invalid run config", 422, { cause: error.issues });
    }
    return data;
}


export function requireItemConfig(runConfig: ReturnType<typeof requireRunConfig>, sessionItems: SessionItem[], itemId: string, itemType?: "input" | "output") {
    let itemConfig = findItemConfigById(runConfig, sessionItems, itemId, itemType);

    if (!itemConfig) {
        throw new AgentViewError(`Item not found in configuration for item '${itemId}'.`, 400);
    }

    return itemConfig
}

export function requireScoreConfig(scores: { name: string; schema: any }[] | undefined, scoreName: string) {
    const scoreConfig = scores?.find((scoreConfig) => scoreConfig.name === scoreName)
    if (!scoreConfig) {
        throw new AgentViewError(`Score name '${scoreName}' not found in configuration.'`, 400);
    }
    return scoreConfig
}
