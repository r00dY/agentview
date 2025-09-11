import { useState } from "react";
import type { ReactNode } from "react";
import { useOnFormReset } from '~/hooks/useOnFormReset';
import type { FormInputProps } from "~/types";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "./ui/toggle-group"

export type FormFieldBaseProps = {
    id: string,
    children: ReactNode
    label?: string;
    description?: string;
    error?: string;
};

export function FormFieldBase<T=any>(props: FormFieldBaseProps) {
    const { id, label,description, error, children } = props;
    return <div className="flex flex-row gap-4">
        {label && <label className="text-sm text-gray-700 w-[170px] flex-shrink-0 truncate" htmlFor={id}>{label}</label>}
        {<div>
            <div>
                {children}
            </div>
            {description && <div className="text-xs text-gray-500">{description}</div>}
            {error && <div className="text-xs text-red-500">{error}</div>}
        </div>}
    </div>
}

export type FormFieldProps<T=any> = Omit<FormFieldBaseProps, "children"> & {
    name: string,
    defaultValue: T,
    options?: any,
    InputComponent: React.ComponentType<FormInputProps<T>>,
}

export function FormField<T=any>(props: FormFieldProps<T>) {
    const { id, label, description, error, name, defaultValue, InputComponent, options } = props;
    const [fieldValue, setFieldValue] = useState<T>(defaultValue);

    const inputRef = useOnFormReset(() => {
        setFieldValue(defaultValue);
    });

    // const [fieldError, setFieldError] = useState<string | undefined>(error);

    // useEffect(() => {
    //     setFieldError(error);
    // }, [error]);

    return <>
        <input type="hidden" name={name} value={JSON.stringify(fieldValue) ?? ""} ref={inputRef}/>
        <FormFieldBase id={id} label={label} description={description} error={error}>
            <InputComponent id={id} name={`agentview__${name}`} value={fieldValue} options={options} onChange={(newValue) => {
                setFieldValue(newValue);
                // setFieldError(undefined);
            }}/>
        </FormFieldBase>
    </>
}

export const TextInput : React.ComponentType<FormInputProps<string | undefined>> = ({ value, onChange, name, id })=> {
    return <Input value={value ?? ""} placeholder="Enter value" onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} name={name} id={id}/>
}


export const SwitchInput : React.ComponentType<FormInputProps<boolean>> = ({ value, onChange, name, id })=> {
    return <Switch checked={value ?? false} onCheckedChange={(checked) => onChange(checked)} name={name} id={id}/>
}

export const ToggleBooleanInput : React.ComponentType<FormInputProps<boolean | undefined>> = ({ value, onChange, name, id, options })=> {
    const toggleValue = value === true ? "true" : value === false ? "false" : "";

    const TrueIcon = options?.true?.icon ?? null;
    const trueLabel = TrueIcon ? null : options?.true?.label ?? "True";

    const FalseIcon = options?.false?.icon ?? null;
    const falseLabel = FalseIcon ? null : options?.false?.label ?? "False";

    return (
    <ToggleGroup type="single" variant="outline" size="sm" value={toggleValue} onValueChange={(value) => {
        if (value === "") {
            onChange(undefined);
        } else {
            onChange(value === "true");
        }
    }}>
        <ToggleGroupItem value="true" aria-label="Toggle true">
            {TrueIcon ? <TrueIcon className="h-2 w-2" /> : null}
            {trueLabel}
        </ToggleGroupItem>
        <ToggleGroupItem value="false" aria-label="Toggle false">
            {FalseIcon ? <FalseIcon className="h-2 w-2" /> : null}
            {falseLabel}
        </ToggleGroupItem>
    </ToggleGroup>
    )
}