import { useEffect, useState } from "react";
import type { ControlComponentProps } from "../types";
import { Button } from "./ui/button";
import { type Option, optionValueToString } from "./Option";

// fixme: totally not accessible
export const ToggleGroupControl = <T extends string | number | boolean = string>(props: ControlComponentProps<T> & { options: Option<T>[], hideOptionsOnSelect?: boolean, showLabels?: "always" | "on-select" | "never", optimistic?: boolean }) => {
    const { onChange, options, hideOptionsOnSelect, showLabels = "always", optimistic = false } = props;
    const [value, setValue] = useState(props.value);

    useEffect(() => {
        setValue(value);
    }, [value]);

    return <div className="flex flex-row">
        {options.map((option) => {
            const isSelected = value === option.value;

            if (hideOptionsOnSelect && value !== null && value !== undefined && !isSelected) {
                return null;
            }

            let label : string | undefined = option.label;

            if (showLabels === "never") {
                label = undefined;
            }
            else if (showLabels === "on-select" && !isSelected) {
                label = undefined;
            }

            const onClick = () => {
                const newValue = isSelected ? null : option.value;
                if (optimistic) {
                    setValue(newValue);
                }
                onChange(newValue);
            }

            const stringValue = optionValueToString(option.value);

            return <Button
                key={stringValue}
                type="button"
                variant="ghost"
                size={label ? "sm" : "icon_sm"}
                value={stringValue}
                className={`${isSelected ? "[&>svg]:fill-current [&>svg]:stroke-none" : ""}`}
                onClick={onClick}

            >
                {option.icon && <option.icon />}
                {label}
            </Button>
        })}
    </div>
}