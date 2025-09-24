import type { AgentViewConfig } from "~/types";

export function loadConfig(): AgentViewConfig {
    const config: AgentViewConfig | undefined = (window as any).agentview?.config;
    if (!config) {
        throw new Error("Config not found");
    }
    return config;
}

export const config = loadConfig();