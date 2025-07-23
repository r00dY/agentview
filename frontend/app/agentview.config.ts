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
    // run: async function (input: any) {
    //     await new Promise(resolve => setTimeout(resolve, 1000));
    //     return [{
    //         type: "message",
    //         role: "assistant",
    //         content: "I got your question 1"
    //     },
    //     {
    //         type: "message",
    //         role: "assistant",
    //         content: "I got your question 2"
    //     },
    //     {
    //         type: "message",
    //         role: "assistant",
    //         content: "I got your question 3"
    //     }]
    // },

    run: async function* (input: any) {

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 1"
        };

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 2"
        };

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 3"
        };

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 4"
        };

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 5"
        };

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 6"
        };

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 7"
        };

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 8"
        };

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 9"
        };

        await new Promise(resolve => setTimeout(resolve, 3000));

        yield {
            type: "message",
            role: "assistant",
            content: "I got your question 10"
        };

        // // Then yield the real response
        // const response = await client.responses.create({
        //     model: "gpt-4.1",
        //     input: [
        //         {
        //             role: "developer",
        //             content: "You are witty and a little silly, answer in this silly way. You are also a little bit of a know it all."
        //         },
        //         ...input.thread.activities.map((a: any) => ({
        //             role: a.role,
        //             content: a.content
        //         }))
        //     ]
        // });

        // yield {
        //     type: "message",
        //     role: "assistant",
        //     content: response.output_text
        // };
    }
}
