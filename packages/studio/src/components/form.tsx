import { useState } from "react";
import type { ReactNode } from "react";
import { useOnFormReset } from '~/hooks/useOnFormReset';
import type { AgentSessionInputComponent, FormInputProps } from "~/types";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import {
    ToggleGroup,
    ToggleGroupItem,
} from "./ui/toggle-group"
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { FormDescription, FormItem, FormLabel, FormMessage, useFormField, FormField as FormFieldShadcn, FormControl } from "./ui/form";
import React from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";


import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "./ui/form";
import { Alert } from "./ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { z } from "zod";

export type FormFieldBaseProps = {
    id: string,
    children: ReactNode
    label?: string;
    description?: string;
    error?: string;
};

export function FormFieldBase<T = any>(props: FormFieldBaseProps) {
    const { id, label, description, error, children } = props;
    return <div className="flex flex-row gap-4">
        {label && <label className="text-sm text-gray-700 w-[170px] flex-shrink-0 truncate" htmlFor={id}>{label}</label>}
        {<div className="flex-1">
            <div>
                {children}
            </div>
            {description && <div className="text-xs text-gray-500">{description}</div>}
            {error && <div className="text-xs text-red-500">{error}</div>}
        </div>}
    </div>
}

export type FormFieldProps<T = any> = Omit<FormFieldBaseProps, "children"> & {
    name: string,
    defaultValue: T,
    options?: any,
    InputComponent: React.ComponentType<FormInputProps<T>>,
}

export function FormField<T = any>(props: FormFieldProps<T>) {
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
        <input type="hidden" name={name} value={JSON.stringify(fieldValue) ?? ""} ref={inputRef} />
        <FormFieldBase id={id} label={label} description={description} error={error}>
            <InputComponent id={id} name={`agentview__${name}`} value={fieldValue} options={options} onChange={(newValue) => {
                setFieldValue(newValue);
                // setFieldError(undefined);
            }} />
        </FormFieldBase>
    </>
}

export const TextInput: React.ComponentType<FormInputProps<string | undefined>> = ({ value, onChange, name, id }) => {
    return <Input value={value ?? ""} placeholder={"Enter value"} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} name={name} id={id} />
}

export const TextareaInput: React.ComponentType<FormInputProps<string | undefined>> = ({ value, onChange, name, id }) => {
    return <Textarea value={value ?? ""} placeholder={"Enter value"} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} name={name} id={id} />
}

export const SwitchInput: React.ComponentType<FormInputProps<boolean>> = ({ value, onChange, name, id }) => {
    return <Switch checked={value ?? false} onCheckedChange={(checked) => onChange(checked)} name={name} id={id} />
}

export const ToggleBooleanInput: React.ComponentType<FormInputProps<boolean | undefined>> = ({ value, onChange, name, id, options }) => {
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

export const SelectInput: React.ComponentType<FormInputProps<string | undefined>> = ({ value, onChange, name, id, options }) => {
    return <Select onValueChange={(value) => onChange(value === "" ? undefined : value)} defaultValue={value}>
        <SelectTrigger>
            <SelectValue placeholder="Pick option" />
        </SelectTrigger>
        <SelectContent>
            {options.items.map((item: any) => {
                const value = typeof item === 'string' ? item : item.value;
                const label = typeof item === 'string' ? item : (item.label ?? item.value)

                return <SelectItem value={item.value}>{item.label}</SelectItem>
            })}
        </SelectContent>
    </Select>
}

/** NEW VERSION **/

export type AVFormControlProps<TInput = any, TOutput = TInput> = ControllerRenderProps<FieldValues, any> & {
    value: TInput
    onChange: (value: TOutput) => void
}

export type AVFormControl<TInput = any, TOutput = TInput> = React.ComponentType<AVFormControlProps<TInput, TOutput>>;

export type AVFormFieldProps<TInput = any, TOutput = TInput> = {
    name: string,
    label?: string,
    description?: string,
    disabled?: boolean,
    control: AVFormControl<TInput, TOutput>
}

export function AVFormField<TInput = any, TOutput = TInput>(props: AVFormFieldProps<TInput, TOutput>) {    
    const Control = props.control;

    return <FormFieldShadcn
        name={props.name}
        disabled={props.disabled}
        render={({ field }) => {
            return <FormItem>
                <FormLabel>{props.label ?? props.name}</FormLabel>
                <Control {...field} />
                {props.description && <FormDescription>
                    {props.description}
                </FormDescription>}
                <FormMessage />
            </FormItem>
        }}
    />
}

export const AVInput = ({ value, onChange, name, ...inputProps }: React.ComponentProps<"input"> & AVFormControlProps<string | undefined>) => {
    return <FormControl>
        <Input
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
            name={name}
            {...inputProps}
        />
    </FormControl>
}

export type AVFormHelperField<TValue extends z.ZodTypeAny = any, TInput = any, TOutput = TInput> = AVFormFieldProps<TInput, TOutput> & {
    schema: TValue
    defaultValue?: z.infer<TValue>
}

export function form(fields: AVFormHelperField[]) : AgentSessionInputComponent {
    const defaultValues : Record<string, any> = {}
    for (const field of fields) {
        defaultValues[field.name] = field.defaultValue;
    }

    return ({ onSubmit, error, schema }) => {
        const form = useForm({
            resolver: zodResolver<any, any, any>(schema),
            defaultValues
        })
    
        return <Form {...form}>
            { error && <Alert variant="destructive" className="mb-4">
                <AlertCircleIcon className="h-4 w-4" />
                <AlertDescription>{error.message}</AlertDescription>
            </Alert> }
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {fields.map((field) => {
                    const { defaultValue, ...fieldProps } = field;
                    return <AVFormField
                        {...fieldProps}
                    />
                })}
                <Button type="submit">Submit</Button>
            </form>
        </Form>
    }
}

export function field<TValue extends z.ZodTypeAny = any, TInput = any, TOutput = TInput>(props: AVFormHelperField<TValue, TInput, TOutput>) {
    return props;
}

const test = field({
    name: "username",
    label: "Username",
    control: AVInput,
    schema: z.number(),
    defaultValue: 10
})