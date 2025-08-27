import type { AgentViewConfig } from "./types";
import { z } from "zod";
import { SwitchInput, TextInput, ToggleBooleanInput } from "./components/form";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { DisplayBooleanComponent, DisplayTextComponent } from "./components/display";

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
                            name: "user_reaction",
                            title: "Reaction",
                            schema: z.boolean(),
                            input: ToggleBooleanInput,
                            display: DisplayBooleanComponent,
                            options: {
                                true: {
                                    icon: ThumbsUp,
                                    label: "Like"
                                },
                                false: {
                                    icon: ThumbsDown,
                                    label: "Don't like"
                                }
                            }
                        },
                        {
                            name: "whatever",
                            title: "Whatever",
                            schema: z.string(),
                            input: TextInput,
                            display: DisplayTextComponent
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

