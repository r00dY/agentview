import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { cn } from "../lib/utils"
import { Button } from "./ui/button"
import { Pill } from "./Pill"
import type { ControlComponentProps } from "../types"
import { optionStringToValue, optionValueToString, type Option } from "./Option"

function Select({
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
    return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectContent({
    className,
    children,
    position = "popper",
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Content
                data-slot="select-content"
                className={cn(
                    "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
                    position === "popper" &&
                    "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
                    className
                )}
                position={position}
                {...props}
            >
                <SelectScrollUpButton />
                <SelectPrimitive.Viewport
                    className={cn(
                        "p-1",
                        position === "popper" &&
                        "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
                    )}
                >
                    {children}
                </SelectPrimitive.Viewport>
                <SelectScrollDownButton />
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    )
}

function SelectScrollUpButton({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
    return (
        <SelectPrimitive.ScrollUpButton
            data-slot="select-scroll-up-button"
            className={cn(
                "flex cursor-default items-center justify-center py-1",
                className
            )}
            {...props}
        >
            <ChevronUpIcon className="size-4" />
        </SelectPrimitive.ScrollUpButton>
    )
}

function SelectScrollDownButton({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
    return (
        <SelectPrimitive.ScrollDownButton
            data-slot="select-scroll-down-button"
            className={cn(
                "flex cursor-default items-center justify-center py-1",
                className
            )}
            {...props}
        >
            <ChevronDownIcon className="size-4" />
        </SelectPrimitive.ScrollDownButton>
    )
}

export function PillSelect<T extends string | number | boolean>(props: ControlComponentProps<T> & { options: Option<T>[], placeholder?: string, className?: string }) {
    const { value, onChange, options, placeholder = "Empty", className } = props;
    const selectedOption = options.find(opt => opt.value === value);
    const [open, setOpen] = React.useState(false);

    const stringValue = (value === null || value === undefined) ? "" : optionValueToString(value);

    return (
        <Select open={open} onOpenChange={setOpen} value={stringValue} onValueChange={(newValue) => {
            if (newValue === "") {
                onChange(null);
            }
            else {
                onChange(optionStringToValue(newValue, options));
            }
        }}>
            <SelectPrimitive.Trigger asChild>
                <Button variant="ghost" size="sm" className={cn("justify-start px-1.5", open && "bg-accent", className)}>
                    {selectedOption ? (
                        <Pill color={selectedOption.color}>
                            {selectedOption.icon}
                            {selectedOption.label ?? selectedOption.value}
                        </Pill>
                    ) : (
                        <span className="text-muted-foreground text-sm">{placeholder}</span>
                    )}
                </Button>
            </SelectPrimitive.Trigger>

            <SelectContent>
                {options.map((option) => (
                    <SelectPrimitive.Item
                        data-slot="select-item"
                        className={"focus:bg-accent hover:bg-accent cursor-pointer outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 py-1 px-1 rounded-md flex w-full"}
                        value={optionValueToString(option.value)}
                    >
                        <Pill color={option.color}>
                            {option.icon}
                            <SelectPrimitive.ItemText>{option.label ?? option.value}</SelectPrimitive.ItemText>
                        </Pill>
                    </SelectPrimitive.Item>
                ))}
            </SelectContent>
        </Select>
    );
}
