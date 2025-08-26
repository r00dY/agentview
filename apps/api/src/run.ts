// import OpenAI from "openai";
import type { RunFunction } from "./shared/types";

// const client = new OpenAI({
//     apiKey: process.env.OPENAI_API_KEY,
// });

export const run : RunFunction = async function* (input: any) {
    // Emit version manifest first
    yield {
        type: "manifest",
        version: "1.0.2",
        env: "dev",
        metadata: {
            description: "Initial version of the agent",
            features: ["streaming", "lorem_ipsum_responses"]
        }
    };

    const lastUserMessage = input.thread.activities[input.thread.activities.length - 1].content;

    const NUM_MESSAGES = 3;

    for (let i = 0; i < NUM_MESSAGES; i++) {

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
                    `Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`,
                    `Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.\n\nNemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem. \n\nUt enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur?`,
                    // `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Index: ${i + 1}`,
                    // `Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam. This is index ${i + 1}.`,
                    // `Quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Index: ${i + 1}`,
                    // `Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. The current index is ${i + 1}.`,
                    // `Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. This was index ${i + 1}.`,
                    // `Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Index: ${i + 1}`,
                    // `Nullam varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris. Index: ${i + 1}`,
                    // `Integer in mauris eu nibh euismod gravida. Duis ac tellus et risus vulputate vehicula. The index is ${i + 1}.`,
                    // `Donec lobortis risus a elit. Etiam tempor. Ut ullamcorper, ligula eu tempor congue, eros est euismod turpis, id tincidunt sapien risus a quam. Index: ${i + 1}`,
                    // `Maecenas fermentum consequat mi. Donec fermentum. Pellentesque malesuada nulla a mi. Duis sapien sem, aliquet nec, commodo eget, consequat quis, neque. Index: ${i + 1}.`
                ];
                // Pick a random variant each time
                return loremVariants[Math.floor(Math.random() * loremVariants.length)];
            })(),
        };

        yield message;
    }       
}