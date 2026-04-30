import { Pill } from "./Pill";
import { type Option, optionValueToString } from "./Option";

export function OptionDisplay<T extends string | number | boolean = string>({ value, options }: { value: T, options: Option<T>[] }) {
    const option = options.find(opt => opt.value === value);

    if (!option) {
        return <div className="text-sm text-muted-foreground">Undefined</div>;
    }

    return (
        <Pill size="xs" color={option.color}>
            {option.icon && <option.icon />}
            {option.label ?? option.value}
        </Pill>
    );
}

export function OptionsDisplay<T extends string | number | boolean = string>({ value, options }: { value: T[], options: Option<T>[] }) {
    const selectedOptions = value
        .map(v => options.find(opt => opt.value === v))
        .filter((opt): opt is Option<T> => opt !== undefined);

    if (selectedOptions.length === 0) {
        return <div className="text-sm text-muted-foreground">Empty</div>;
    }

    return (
        <div className="flex flex-wrap gap-1">
            {selectedOptions.map((option) => (
                <Pill key={optionValueToString(option.value)} size="xs" color={option.color}>
                    {option.icon && <option.icon />}
                    {option.label ?? option.value}
                </Pill>
            ))}
        </div>
    );
}
