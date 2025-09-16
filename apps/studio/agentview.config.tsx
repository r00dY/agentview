import type { AgentViewConfig } from "./app/types";
import { z } from "zod";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { TextInput, ToggleBooleanInput } from "./app/components/form";
import { ActivityAssistantMessageComponent, ActivityUserMessageComponent, DisplayBooleanComponent, DisplayTextComponent } from "./app/components/display";
import { ProductDisplay, ProductSelect } from "product_components";

export const config: AgentViewConfig = {
    threads: [
        {
            type: "pdp_chat",
            url: "http://127.0.0.1:8000/product_chat",
            metadata: [
                {
                    name: "product_id",
                    title: "Product",
                    schema: z.string(),
                    input: ProductSelect,
                    display: ProductDisplay
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
                    display: ActivityUserMessageComponent
                },
                {
                    type: "change_page",
                    title: "Change page",
                    content: z.object({
                        product_id: z.string(),
                    }),
                    isInput: true,
                    input: ({ value, onChange }) => {
                        return <ProductSelect value={value?.product_id} onChange={(product_id) => { onChange({ product_id }) }} />
                    },
                    display: ({ value }) => <div className="flex flex-row items-center justify-end gap-2"><div className="text-muted-foreground">Page changed to</div><ProductDisplay value={value?.product_id} /></div>
                },
                {
                    type: "product_comment",
                    title: "Product comment",
                    content: z.string(),
                    display: DisplayTextComponent
                },
                {
                    type: "message",
                    role: "assistant",
                    content: z.string(),
                    display: ActivityAssistantMessageComponent,
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