import * as React from "react"
import * as Popover from "@radix-ui/react-popover"
import { XIcon } from "lucide-react"
import { cn } from "../lib/utils"
import { Button } from "./ui/button"
import { Pill } from "./Pill"
import type { ControlComponentProps } from "../types"
import { optionValueToString, type Option } from "./Option"

export function PillMultiSelect<T extends string | number | boolean>(props: ControlComponentProps<T[]> & { options: Option<T>[], placeholder?: string, className?: string }) {
    const { value, onChange, options, placeholder = "Empty", className } = props;
    const selectedValues = value ?? [];

    const selectedOptions = selectedValues
        .map(v => options.find(opt => opt.value === v))
        .filter((opt): opt is Option<T> => opt !== undefined);

    const handleRemove = (e: React.MouseEvent, valueToRemove: T) => {
        e.stopPropagation();
        const newValues = selectedValues.filter(v => v !== valueToRemove);
        onChange(newValues.length > 0 ? newValues : null);
    };

    const handleAdd = (valueToAdd: T) => {
        if (!selectedValues.includes(valueToAdd)) {
            onChange([...selectedValues, valueToAdd]);
        }
    };

    const [open, setOpen] = React.useState(false);

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <Button variant="ghost" size="sm" className={cn("justify-start px-1.5 h-auto min-h-8", open && "bg-accent", className)}>
                    {selectedOptions.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                            {selectedOptions.map((option) => (
                                <Pill key={optionValueToString(option.value)} color={option.color} className={cn(open && "pr-0.5")}>
                                    {option.icon && <option.icon />}
                                    {option.label ?? option.value}
                                    {open && (
                                        <button
                                            type="button"
                                            onClick={(e) => handleRemove(e, option.value)}
                                            className="ml-0.5 rounded-xs hover:bg-black/10 p-0.5"
                                        >
                                            <XIcon className="size-3" />
                                        </button>
                                    )}
                                </Pill>
                            ))}
                        </div>
                    ) : (
                        <span className="text-muted-foreground text-sm">{placeholder}</span>
                    )}
                </Button>
            </Popover.Trigger>

            <Popover.Portal>
                <Popover.Content
                    className="bg-popover text-popover-foreground z-50 min-w-[8rem] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border shadow-md p-1"
                    sideOffset={4}
                    align="start"
                >
                    {options.map((option) => {
                        const isSelected = selectedValues.includes(option.value);
                        return (
                            <div
                                key={optionValueToString(option.value)}
                                className={cn(
                                    "focus:bg-accent hover:bg-accent cursor-pointer outline-none select-none py-1 px-1 rounded-md flex w-full",
                                    isSelected && "bg-accent/50"
                                )}
                                onClick={() => handleAdd(option.value)}
                            >
                                <Pill color={option.color}>
                                    {option.icon && <option.icon />}
                                    {option.label ?? option.value}
                                </Pill>
                            </div>
                        );
                    })}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
