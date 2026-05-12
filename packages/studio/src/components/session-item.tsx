import { cva, type VariantProps } from "class-variance-authority";
import { ArrowUpIcon, ChevronDownIcon, PauseIcon } from "lucide-react";
import { marked } from "marked";
import React, { useState } from "react";
import { cn } from "../lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "./ui/input-group";

/**
 * Message
 */
const messageVariants = cva(
    "",
    {
        variants: {
            variant: {
                default:
                    "",
                fill:
                    "px-3 py-2 rounded-lg bg-neutral-100",
            }
        },
        defaultVariants: {
            variant: "default"
        },
    }
)

type MessageVariant = VariantProps<typeof messageVariants>["variant"];
const MessageContext = React.createContext<{ variant: MessageVariant } | undefined>(undefined);

export function Message({
    variant,
    className,
    children,
    header,
    ...props
}: VariantProps<typeof messageVariants> & React.ComponentProps<"div"> & { header?: React.ReactNode }) {
    return <MessageContext.Provider value={{ variant }}>
        <div className={cn(messageVariants({ variant }), className)} {...props}>
            {header && <div className="mb-2">{header}</div>}
            <AutoContent>{children}</AutoContent>
        </div>
    </MessageContext.Provider>
}

/**
 * Step
 */
const StepContext = React.createContext<{ collapsible: boolean } | undefined>(undefined);

export function Step({ className, children, collapsible = false, ...props }: React.ComponentProps<"div"> & { collapsible?: boolean }) {
    const content = (
        <StepContext.Provider value={{ collapsible }}>
            <div className={cn(
                      "px-3 py-2 rounded-lg border",
                      "space-y-1 group-data-[state=closed]:space-y-0",
                      className
            )} {...props}>
                {children}
            </div>
        </StepContext.Provider>
    );

    if (collapsible) {
        return <Collapsible className="group">{content}</Collapsible>;
    }

    return content;
}

export function StepTitle({ className, children, ...props }: React.ComponentProps<"div">) {
    const stepContext = React.useContext(StepContext);
    const collapsible = stepContext?.collapsible ?? false;

    const content = (
        <div
            className={cn(
                "text-muted-foreground text-sm font-normal flex items-center gap-1",
                "[&_svg]:pointer-events-none [&_svg]:shrink-0",
                "[&_svg:not([class*='size-'])]:size-3",
                collapsible && "cursor-pointer select-none",
                className
            )}
            {...props}
        >
            {children}
            {collapsible && (
                <ChevronDownIcon className={cn(
                    "ml-auto transition-transform duration-200 size-3",
                    "group-data-[state=open]:rotate-[-180deg]"
                )} />
            )}
        </div>
    );

    if (collapsible) {
        return <CollapsibleTrigger asChild>{content}</CollapsibleTrigger>;
    }

    return content;
}

export function StepContent({ className, children, ...props }: React.ComponentProps<"div"> & { children: React.ReactNode }) {
    const stepContext = React.useContext(StepContext);
    const collapsible = stepContext?.collapsible ?? false;

    const content = <div className={cn("text-sm text-muted-foreground", className)} {...props}>
        <AutoContent>{children}</AutoContent>
    </div>;

    if (collapsible) {
        return <CollapsibleContent>{content}</CollapsibleContent>;
    }

    return content;
}



/**
 * Markdown
 */
const markdownVariants = cva(
    "",
    {
        variants: {
            size: {
                default: "text-md",
                sm: "text-sm"
            }
        },
        defaultVariants: {
            size: "default"
        },
    }
)

// this is general purpose component, can live indepently, only if it's inside Step or Message, defaults change.
export function Markdown({ className, text, ...props }: VariantProps<typeof markdownVariants> & React.ComponentProps<"div"> & { text: string }) {
    const messageContext = React.useContext(MessageContext);
    const stepContext = React.useContext(StepContext);
    const defaultSize = messageContext ? "default" : (stepContext ? "sm" : "default");

    const size = props.size ?? defaultSize;

    return <div
        className={
            cn("prose prose-ul:list-disc prose-ol:list-decimal prose-a:underline text-[inherit]", markdownVariants({ size }), className)}
        {...props}
        dangerouslySetInnerHTML={{ __html: marked.parse(text, { async: false }) }}
    ></div>
}

/**
 * JSONView
 */
const jsonViewVariants = cva(
    "",
    {
        variants: {
            variant: {
                default:
                    "p-3 rounded-md bg-neutral-50",
                ghost:
                    "",
            }
        },
        defaultVariants: {
            variant: "default"
        },
    }
)

// this is general purpose component, can live indepently, only if it's inside Step or Message, defaults change.
export function JSONView({ value, className, ...props }: VariantProps<typeof jsonViewVariants> & React.ComponentProps<"pre"> & { value: any }) {
    const messageContext = React.useContext(MessageContext);
    const defaultVariant = messageContext ? (messageContext.variant === "fill" ? "ghost" : "default") : undefined;
    const variant = props.variant ?? defaultVariant;

    return <pre className={cn(
        "overflow-x-scroll text-sm",
        jsonViewVariants({ variant }),
        className)}
        {...props}
    >
        {JSON.stringify(value, null, 2)}
    </pre>
}


export function AutoContent({ children }: { children: React.ReactNode }) {
    const isText = typeof children === "string";
    const isPlainObject = typeof children === "object" && children !== null && !Array.isArray(children) && !React.isValidElement(children);

    if (isPlainObject) {
        return <JSONView value={children} />;
    }
    if (isText) {
        return <Markdown text={children} />;
    }

    return children;
}

export function UserMessage({ children, className, header, ...props }: { children: React.ReactNode, className?: string, header?: React.ReactNode } & React.ComponentProps<"div">) {
    return <Message variant="fill" className={className} header={header} {...props}>
        <AutoContent>{children}</AutoContent>
    </Message>
}

export function AssistantMessage({ children, className, header, ...props }: { children: React.ReactNode, className?: string, header?: React.ReactNode } & React.ComponentProps<"div">) {
    return <Message variant="default" className={className} header={header} {...props}>
        <AutoContent>{children}</AutoContent>
    </Message>
}

// export function AssistantMessage({ children, className, size, ...props }: { children: React.ReactNode, className?: string, size?: ItemCardSize } & React.ComponentProps<"div">) {
//     return <ItemCard variant="default" className={className} size={size} {...props}>
//         <ItemCardAutoContent>{children}</ItemCardAutoContent>
//     </ItemCard>
// }

// export function StepItem({ children, className, size = "sm", ...props }: { children: React.ReactNode, className?: string, size?: ItemCardSize } & React.ComponentProps<"div">) {
//     return <ItemCard variant="outline" className={className} size={size} {...props}>
//         <ItemCardAutoContent>{children}</ItemCardAutoContent>
//     </ItemCard>
// }


export function UserMessageInput(props: { isRunning: boolean, onCancel: () => void, onSubmit: (value: string) => void, placeholder?: string }) {
    const [value, setValue] = useState<string>("");

    return <form onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() === "") return;
        props.onSubmit(value);
        setValue("");
    }}>
        <InputGroup>
            <InputGroupTextarea placeholder={props.placeholder ?? "Enter your message..."} rows={2} className="min-h-0 pb-0 md:text-md" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (value.trim() !== "" && !props.isRunning) {
                            props.onSubmit(value);
                            setValue("");
                        }
                    }
                }} />

            <InputGroupAddon align="block-end">
                <InputGroupButton
                    variant="default"
                    className={`rounded-full ml-auto ${props.isRunning ? "hidden" : ""}`}
                    size="icon-sm"
                    type="submit"
                    disabled={props.isRunning || value.trim() === ""}
                >
                    <ArrowUpIcon />
                    <span className="sr-only">Send</span>
                </InputGroupButton>

                <InputGroupButton
                    variant="default"
                    className={`rounded-full ml-auto ${!props.isRunning ? "hidden" : ""}`}
                    size="icon-sm"
                    onClick={() => {
                        props.onCancel();
                    }}
                >
                    <PauseIcon />
                    <span className="sr-only">Pause</span>
                </InputGroupButton>

            </InputGroupAddon>
        </InputGroup>

    </form>
}
