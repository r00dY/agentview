import { z } from "zod";

export const config : any = {
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
                            name: "user_reaction",
                            title: "Reaction",
                            schema: z.boolean(),
                        },
                        {
                            name: "whatever",
                            title: "Whatever",
                            schema: z.string()
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

