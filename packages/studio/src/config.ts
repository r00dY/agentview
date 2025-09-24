import type { AgentViewConfig } from "~/types";

export function loadConfig(): AgentViewConfig {
    return (window as any).agentview.config as AgentViewConfig;
}

export const config = loadConfig();