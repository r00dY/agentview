import type { Color } from "agentview/colors";
import type { LucideIcon } from "lucide-react";

export type Option<T extends string | number | boolean> = {
    value: T;
    icon?: LucideIcon;
    label?: string;
    color?: Color | string;
}

export function optionValueToString(value: string | number | boolean) {
    return String(value);
}

export function optionStringToValue<T extends string | number | boolean>(value: string, options: Option<T>[]): T {
    for (const option of options) {
        if (String(option.value) === value) {
            return option.value;
        }
    }
    throw new Error(`Value '${value}' not found in options`);
}