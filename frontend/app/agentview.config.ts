import type { AgentViewConfig } from "./.server/types";
import { z } from "zod";

export const config : AgentViewConfig = {
    email: async (payload: any) => {
        console.log(payload)
    },
    threads: [
        {
            type: "pdp_chat",
            metadata: z.object({
                product_id: z.string()
            }),
            activities: [
                {
                    type: "message",
                    role: "user",
                    content: z.string()
                },
                {
                    type: "message",
                    role: "assistant",
                    content: z.string(),
                    scores: [
                        {
                            name: "user_satisfaction",
                            title: "User satisfaction",
                            schema: z.boolean()
                        }
                        // {
                        //     name: "helpfulness",
                        //     title: "How helpful was the response",
                        //     schema: z.number().min(1).max(5)
                        // }
                    ]
                }
            ]
        }
    ]
}
