import type { AgentViewConfig } from "./app/types";
import { z } from "zod";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { TextInput, ToggleBooleanInput } from "./app/components/form";
import { DisplayBooleanComponent, DisplayTextComponent } from "./app/components/display";

export const config: AgentViewConfig = {
    threads: [
        {
            type: "pdp_chat",
            url: "http://127.0.0.1:8000/run_stream",
            metadata: [
                {
                    name: "product_id",
                    title: "Product ID",
                    schema: z.string(),
                    input: TextInput,
                    display: DisplayTextComponent
                }
            ],
            activities: [
                {
                    type: "message",
                    role: "user",
                    title: "Message",
                    content: z.string(),
                    isInput: true,
                    input: TextInput,
                    display: DisplayTextComponent
                },
                {
                    type: "dupa",
                    title: "Change page",
                    content: z.string(),
                    isInput: true,
                    input: TextInput,
                    display: DisplayTextComponent
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
                    ]
                }
            ]
        }
    ]
}