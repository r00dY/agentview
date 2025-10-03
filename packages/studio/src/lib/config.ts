import type { AgentViewConfig, AgentConfig, SessionItemConfig } from "~/types";

export function requireAgentConfig(config: AgentViewConfig, agentName: string) {
    const agentConfig = config.agents?.find((agent) => agent.name === agentName);
    if (!agentConfig) {
        throw new Error(`Agent config not found for agent '${agentName}'`);
    }
    return agentConfig;
}

export function requireItemConfig(agentConfig: AgentConfig, type: string, role?: string | null, runItemType?: "input" | "output" | "step") {
    let itemConfig: SessionItemConfig | undefined = undefined;

    for (const run of agentConfig.runs) {
        if (!runItemType || runItemType === "input") {
            if (checkItemConfigMatch(run.input, type, role)) {
                itemConfig = run.input
            }
        }
        else if (!runItemType || runItemType === "output") {
            if (checkItemConfigMatch(run.output, type, role)) {
                itemConfig = run.output
            }
        }
        else if (!runItemType || runItemType === "step") {
            itemConfig = run.steps?.find((step) => checkItemConfigMatch(step, type, role))
        }
    }

    if (!itemConfig) {
        throw new Error(`Item config not found for item '${type}' for agent '${agentConfig.name}'. ${runItemType ? `For run item type: ${runItemType}` : ''}`);
    }
    return itemConfig;
}

function checkItemConfigMatch(itemConfig: SessionItemConfig, type: string, role?: string | null) {
    return itemConfig.type === type && (!itemConfig.role || itemConfig.role === role)
}