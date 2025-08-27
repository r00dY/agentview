import type { DisplayComponentProps } from "~/lib/types";
import { Badge } from "./ui/badge";

export function DisplayTextComponent({ value, options }: DisplayComponentProps<string>) {
    return <div className="text-sm">{value}</div>
}


export function DisplayBooleanComponent({ value, options }: DisplayComponentProps<boolean>) {
    if (value === true) {
        const TrueIcon = options?.true?.icon ?? null;
        const trueLabel = options?.true?.label ?? null;
        
        return (
            <Badge variant="default" className="text-xs">
                {TrueIcon && <TrueIcon className="h-3 w-3" />}
                {trueLabel}
            </Badge>
        );
    } else if (value === false) {
        const FalseIcon = options?.false?.icon ?? null;
        const falseLabel = options?.false?.label ?? null;
        
        return (
            <Badge variant="secondary" className="text-xs">
                {FalseIcon && <FalseIcon className="h-3 w-3" />}
                {falseLabel}
            </Badge>
        );
    }
    else {
        return <div className="text-sm">Undefined</div>
    }
}