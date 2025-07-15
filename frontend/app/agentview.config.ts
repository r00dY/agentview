import type { AgentViewConfig } from "./lib/types";

export const config : AgentViewConfig = {
    email: async (payload) => {
        console.log(payload)
    }
}