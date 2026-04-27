import type { AgentConfig, AgentViewConfig } from "./types";
import { like } from "./scores";

export function loadConfig(): AgentViewConfig {
    const config: AgentViewConfig | undefined = (window as any).agentview?.config;
    if (!config) {
        throw new Error("Config not found");
    }

    return config;

    // return {
    //     ...config,
    //     agents: config.agents?.map((agent) => {
    //         return {
    //             ...agent,
    //             runs: agent.runs?.map((run) => {
    //                 const runScores = [...(run.scores ?? [])];
    //                 if (!run.disableLike) {
    //                     runScores.unshift(like());
    //                 }
    //                 return { ...run, scores: runScores }
    //             })
    //         }
    //     })
    // }
}

export const config = loadConfig();