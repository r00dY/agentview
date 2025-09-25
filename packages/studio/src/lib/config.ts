import type { AgentViewConfig, AgentConfig } from "~/types";

export function requireAgentConfig(config: AgentViewConfig, agentName: string) {
    const agentConfig = config.agents?.find((agent) => agent.name === agentName);
    if (!agentConfig) {
        throw new Error(`Agent config not found for agent '${agentName}'`);
    }
    return agentConfig;
}

export function requireItemConfig(agentConfig: AgentConfig, itemType: string, itemRole?: string | null) {
    const itemConfig = agentConfig.items?.find((item) => item.type === itemType && (!item.role || item.role === itemRole));
    if (!itemConfig) {
        throw new Error(`Item config not found for item '${itemType}' for agent '${agentConfig.name}'`);
    }
    return itemConfig;
}