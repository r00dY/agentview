import { defineConfig } from "agentview";
import { z } from "zod";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { SelectInput, TextareaInput, ToggleBooleanInput } from "agentview/components/form";
import { ItemAssistantMessageComponent, ItemUserMessageComponent, DisplayBooleanComponent } from "agentview/components/display";
import { marked } from "marked";
import { ProductDisplay } from "./src/ProductDisplay";
import { ProductSelect } from "./src/ProductSelect";
import { ScoreBadge } from "./src/ScoreBadge";

export default defineConfig({
    sessions: [
        {
            type: "simple_chat",
            url: "http://127.0.0.1:8000/simple_chat",
            items: [
                {
                    isInput: true,
                    type: "message",
                    role: "user",
                    title: "Message",
                    content: z.string(),
                    input: TextareaInput,
                    display: ItemUserMessageComponent
                },
                {
                    type: "message",
                    role: "assistant",
                    content: z.string(),
                    display: ItemAssistantMessageComponent,
                    scores: [
                        {
                            name: "user_reaction",
                            title: "Can it go to client?",
                            schema: z.boolean(),
                            input: ToggleBooleanInput,
                            display: DisplayBooleanComponent,
                            options: {
                                true: {
                                    icon: ThumbsUp,
                                    label: "Yes"
                                },
                                false: {
                                    icon: ThumbsDown,
                                    label: "No"
                                }
                            }
                        }
                    ]
                }
            ]
        },
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
            items: [
                {
                    isInput: true,
                    type: "message",
                    role: "user",
                    title: "Message",
                    content: z.string(),
                    input: TextareaInput,
                    display: ItemUserMessageComponent
                },
                {
                    isInput: true,
                    type: "change_page",
                    title: "Change page",
                    content: z.object({
                        product_id: z.string(),
                    }),
                    input: ({ value, onChange }) => {
                        return <ProductSelect value={value?.product_id} onChange={(product_id) => { onChange({ product_id }) }} />
                    },
                    display: ({ value }) => <div className="flex flex-row items-center justify-end gap-2"><div className="text-muted-foreground">Changed page to</div><ProductDisplay value={value?.product_id} /></div>
                },
                {
                    type: "change_page_output",
                    content: z.object({
                        score: z.enum(["best_fit", "great_option", "optional", "not_recommended"]),
                        comment: z.string()
                    }).nullable(),
                    display: ({ value }) => {
                        return (
                            <div className="relative pr-[10%]">
                                <div className="border p-3 rounded-lg bg-muted">
                                    { !value && <div className="text-muted-foreground italic">Not enough user info to show product comment</div> }
                                    {value && <>
                                        <div className="mb-2">
                                            <ScoreBadge score={value.score} />
                                        </div>
                                        <div
                                            className="prose prose-ul:list-disc prose-ol:list-decimal prose-a:underline"
                                            dangerouslySetInnerHTML={{
                                                __html: marked.parse(value.comment, { async: false })
                                            }}
                                        />
                                    </>}
                                </div>
                            </div>
                        );
                    },
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
                            name: "recommended_score",
                            title: "Your score",
                            schema: z.string(),
                            input: SelectInput,
                            display: ({ value }) => <ScoreBadge score={value} />,
                            options: {
                                items: [
                                    { value: "best_fit", label: "Best Fit" },
                                    { value: "great_option", label: "Great Option" },
                                    { value: "optional", label: "Optional" },
                                    { value: "not_recommended", label: "Not Recommended" }
                                ]
                            }
                        }
                    ]
                },
                {
                    type: "message",
                    role: "assistant",
                    content: z.string(),
                    display: ItemAssistantMessageComponent,
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
                        }
                    ]
                }
            ]
        }
    ]
})
