import { defineConfig } from "~";
import { z } from "zod";
import { Book, ThumbsDown, ThumbsUp } from "lucide-react";
import { AVTextarea, controlForm, field, form, SelectInput, TextareaInput, ToggleBooleanInput } from "~/components/form";
import { ItemAssistantMessageComponent, ItemUserMessageComponent, DisplayBooleanComponent } from "~/components/display";
import { marked } from "marked";
import { ProductDisplay } from "./ProductDisplay";
import { ProductSelect } from "./ProductSelect";
import { ScoreBadge } from "./ScoreBadge";
import { CustomPage } from "./CustomPage";
import { ProductChatInputForm } from "./ProductChatSessionForm";

export default defineConfig({
    apiBaseUrl: "http://localhost:8080",
    agents: [
        {
            name: "simple_chat",
            url: "http://127.0.0.1:8000/simple_chat",
            runs: [
                {
                    input: {
                        type: "message",
                        role: "user",
                        content: z.string(),
                        displayComponent: ItemUserMessageComponent,
                    },
                    output: {
                        type: "message",
                        role: "assistant",
                        content: z.string(),
                        displayComponent: ItemAssistantMessageComponent,
                        scores: [
                            {
                                name: "user_reaction",
                                title: "Can it go to client?",
                                schema: z.boolean(),
                                inputComponent: ToggleBooleanInput,
                                displayComponent: DisplayBooleanComponent,
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
                    },
                    inputComponent: controlForm({
                        defaultValue: "",
                        control: AVTextarea
                    })
                }
            ]
        },
        {
            name: "pdp_chat",
            url: "http://127.0.0.1:8000/product_chat",
            context: z.object({
                product_id: z.string(),
            }),
            inputComponent: form([
                {
                    name: "product_id",
                    label: "Product",
                    schema: z.string(),
                    control: ProductSelect
                }
            ]),
            displayedProperties: ({ session }) => [
                {
                    title: "Product",
                    value: <ProductDisplay value={session.context.product_id} />
                }
            ],
            runs: [
                {
                    title: "Message",
                    input: {
                        type: "message",
                        role: "user",
                        content: z.string(),
                        displayComponent: ItemUserMessageComponent
                    },
                    output: {
                        type: "message",
                        role: "assistant",
                        content: z.string(),
                        displayComponent: ItemAssistantMessageComponent
                    },
                    inputComponent: ({ submit, isRunning, error, schema }) => {
                        return <div>pizda</div>
                    }
                },
                {
                    title: "Change page",
                    input: {
                        type: "change_page",
                        role: "user",
                        content: z.object({
                            product_id: z.string(),
                        }),
                    },
                    output: {
                        type: "message",
                        role: "assistant",
                        content: z.string(),
                        displayComponent: ItemAssistantMessageComponent,
                        scores: [
                            {
                                name: "user_reaction",
                                title: "Reaction",
                                schema: z.boolean(),
                                inputComponent: ToggleBooleanInput,
                                displayComponent: DisplayBooleanComponent,
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
                                inputComponent: SelectInput,
                                displayComponent: ({ value }) => <ScoreBadge score={value} />,
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
                    inputComponent: form([
                        {
                            name: "value",
                            label: "Message",
                            schema: z.string(),
                            control: AVTextarea
                        }
                    ])
                }
            ]
            // items: [
            //     {
            //         input: true,
            //         type: "message",
            //         role: "user",
            //         title: "Message",
            //         content: z.string(),
            //         inputComponent: TextareaInput,
            //         displayComponent: ItemUserMessageComponent
            //     },
            //     {
            //         type: "message",
            //         role: "assistant",
            //         content: z.string(),
            //         displayComponent: ItemAssistantMessageComponent,
            //         scores: [
            //             {
            //                 name: "user_reaction",
            //                 title: "Reaction",
            //                 schema: z.boolean(),
            //                 inputComponent: ToggleBooleanInput,
            //                 displayComponent: DisplayBooleanComponent,
            //                 options: {
            //                     true: {
            //                         icon: ThumbsUp,
            //                         label: "Like"
            //                     },
            //                     false: {
            //                         icon: ThumbsDown,
            //                         label: "Don't like"
            //                     }
            //                 }
            //             }

            //         ]
            //     },
            //     {
            //         input: true,
            //         type: "change_page",
            //         title: "Change page",
            //         content: z.object({
            //             product_id: z.string(),
            //         }),
            //         inputComponent: ({ value, onChange }) => {
            //             return <ProductSelect value={value?.product_id} onChange={(product_id) => { onChange({ product_id }) }} />
            //         },
            //         displayComponent: ({ value }) => <div className="flex flex-row items-center justify-end gap-2"><div className="text-muted-foreground">Changed page to</div><ProductDisplay value={value?.product_id} /></div>
            //     },
            //     {
            //         type: "change_page_output",
            //         content: z.object({
            //             score: z.enum(["best_fit", "great_option", "optional", "not_recommended"]),
            //             comment: z.string()
            //         }).nullable(),
            //         displayComponent: ({ value }) => {
            //             return (
            //                 <div className="relative pr-[10%]">
            //                     <div className="border p-3 rounded-lg bg-muted">
            //                         { !value && <div className="text-muted-foreground italic">Not enough user info to show product comment</div> }
            //                         {value && <>
            //                             <div className="mb-2">
            //                                 <ScoreBadge score={value.score} />
            //                             </div>
            //                             <div
            //                                 className="prose prose-ul:list-disc prose-ol:list-decimal prose-a:underline"
            //                                 dangerouslySetInnerHTML={{
            //                                     __html: marked.parse(value.comment, { async: false })
            //                                 }}
            //                             />
            //                         </>}
            //                     </div>
            //                 </div>
            //             );
            //         },
            //         scores: [
            //             {
            //                 name: "user_reaction",
            //                 title: "Reaction",
            //                 schema: z.boolean(),
            //                 inputComponent: ToggleBooleanInput,
            //                 displayComponent: DisplayBooleanComponent,
            //                 options: {
            //                     true: {
            //                         icon: ThumbsUp,
            //                         label: "Like"
            //                     },
            //                     false: {
            //                         icon: ThumbsDown,
            //                         label: "Don't like"
            //                     }
            //                 }
            //             },
            //             {
            //                 name: "recommended_score",
            //                 title: "Your score",
            //                 schema: z.string(),
            //                 inputComponent: SelectInput,
            //                 displayComponent: ({ value }) => <ScoreBadge score={value} />,
            //                 options: {
            //                     items: [
            //                         { value: "best_fit", label: "Best Fit" },
            //                         { value: "great_option", label: "Great Option" },
            //                         { value: "optional", label: "Optional" },
            //                         { value: "not_recommended", label: "Not Recommended" }
            //                     ]
            //                 }
            //             }
            //         ]
            //     },
            // ]
        }
    ],
    customRoutes: [
        {
            route: {
                path: "/custom",
                Component: CustomPage
            },
            scope: "loggedIn",
            title: <>
                <Book className="size-4" />
                <span>Custom</span>
            </>
        }
    ]
})