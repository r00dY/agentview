import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useOnFormReset } from '~/hooks/useOnFormReset';


export type FormInputProps<T=any> = {
    id: string,
    name: string,
    value: T,
    onChange: (value: T) => void,
}

export type FormFieldBaseProps = {
    id: string,
    children: ReactNode
    label: string;
    description?: string;
    error?: string;
};

export function FormFieldBase<T=any>(props: FormFieldBaseProps) {
    const { id, label,description, error, children } = props;
    return <div className="flex flex-row gap-4">
        <label className="text-sm text-gray-700 w-[170px] flex-shrink-0 truncate" htmlFor={id}>{label}</label>
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
    InputComponent: React.ComponentType<FormInputProps<T>>,
}

export function FormField<T=any>(props: FormFieldProps<T>) {
    const { id, label, description, error, name, defaultValue, InputComponent } = props;
    const [fieldValue, setFieldValue] = useState<T>(defaultValue);

    const inputRef = useOnFormReset(() => {
        setFieldValue(defaultValue);
    });

    console.log("stringified fieldValue", JSON.stringify(fieldValue));
    // const [fieldError, setFieldError] = useState<string | undefined>(error);

    // useEffect(() => {
    //     setFieldError(error);
    // }, [error]);

    return <>
        <input type="hidden" name={name} value={JSON.stringify(fieldValue)} ref={inputRef}/>
        <FormFieldBase id={id} label={label} description={description} error={error}>
            <InputComponent id={id} name={`agentview__${name}`} value={fieldValue} onChange={(newValue) => {
                setFieldValue(newValue);
                // setFieldError(undefined);
            }}/>
        </FormFieldBase>
    </>
}