import type { AgentViewConfig } from "./lib/types";
import { z } from 'zod';
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const config : AgentViewConfig = {
    email: async (payload) => {
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
                    content: z.string()
                }
            ]
        }
    ],
    run: async (input: any) => {
        console.log('run!', input)

        const response = await client.responses.create({
            model: "gpt-4.1",
            input: [
                {
                    role: "developer",
                    content: "You are witty and a little silly, answer in this silly way. You are also a little bit of a know it all."
                },
                ...input.thread.activities.map((a: any) => ({
                    role: a.role,
                    content: a.content
                }))
            ]
        });
        
        return [{
            type: "message",
            role: "assistant",
            content: response.output_text
        }]
    }
}
