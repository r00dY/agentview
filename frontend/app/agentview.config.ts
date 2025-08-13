import type { AgentViewConfig } from "./lib/errors";
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
        const lastUserMessage = input.thread.activities[input.thread.activities.length - 1].content;

        for (let i = 0; i < 10; i++) {

            // Check if lastUserMessage matches "make_error.<number>" pattern
            const match = /^make_error\.(\d+)$/.exec(lastUserMessage);
            let isMakeError = false;
            let errorNumber: number | null = null;
            if (match) {
                isMakeError = true;
                errorNumber = parseInt(match[1], 10);
            }

            if (isMakeError && errorNumber === i) {
                throw { zesralo_sie: 5 }
            }

            await new Promise(resolve => setTimeout(resolve, 1000));

            const message = {
                type: "message",
                role: "assistant",
                content: (() => {
                    const loremVariants = [
                        `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Index: ${i + 1}`,
                        `Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam. This is index ${i + 1}.`,
                        `Quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Index: ${i + 1}`,
                        `Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. The current index is ${i + 1}.`,
                        `Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. This was index ${i + 1}.`,
                        `Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Index: ${i + 1}`,
                        `Nullam varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris. Index: ${i + 1}`,
                        `Integer in mauris eu nibh euismod gravida. Duis ac tellus et risus vulputate vehicula. The index is ${i + 1}.`,
                        `Donec lobortis risus a elit. Etiam tempor. Ut ullamcorper, ligula eu tempor congue, eros est euismod turpis, id tincidunt sapien risus a quam. Index: ${i + 1}`,
                        `Maecenas fermentum consequat mi. Donec fermentum. Pellentesque malesuada nulla a mi. Duis sapien sem, aliquet nec, commodo eget, consequat quis, neque. Index: ${i + 1}.`
                    ];
                    // Pick a random variant each time
                    return loremVariants[Math.floor(Math.random() * loremVariants.length)];
                })(),
            };

            yield message;
        }



        

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
