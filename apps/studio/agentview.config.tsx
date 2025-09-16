import type { AgentViewConfig } from "./app/types";
import { z } from "zod";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { TextareaInput, TextInput, ToggleBooleanInput } from "./app/components/form";
import { ActivityAssistantMessageComponent, ActivityUserMessageComponent, DisplayBooleanComponent, DisplayTextComponent } from "./app/components/display";
import { marked } from "marked";
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
                    input: TextareaInput,
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
                    }
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


function ScoreBadge({ score }: { score: string }) {
    const getScoreStyles = (score: string) => {
        switch (score) {
            case "best_fit":
                return "bg-green-800 text-white"; // Dark green
            case "great_option":
                return "bg-green-500 text-white"; // Green
            case "optional":
                return "bg-yellow-500 text-white"; // Yellow
            case "not_recommended":
                return "bg-red-500 text-white"; // Red
            default:
                return "bg-gray-500 text-white";
        }
    };

    const getScoreLabel = (score: string) => {
        switch (score) {
            case "best_fit":
                return "Best Fit";
            case "great_option":
                return "Great Option";
            case "optional":
                return "Optional";
            case "not_recommended":
                return "Not Recommended";
            default:
                return score;
        }
    };

    return (
        <span className={`inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 ${getScoreStyles(score)}`}>
            {getScoreLabel(score)}
        </span>
    );
}