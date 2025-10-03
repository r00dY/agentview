import type { AgentSessionInputComponent, AgentSessionInputComponentProps } from "~/types"
import { ProductSelect } from "./ProductSelect"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, type Control } from "react-hook-form"
import { Form } from "~/components/ui/form"
import { AVFormField, AVInput } from "~/components/form"
import { Button } from "~/components/ui/button"
import { Alert, AlertDescription } from "~/components/ui/alert"
import { AlertCircleIcon } from "lucide-react"

export const ProductChatInputForm: AgentSessionInputComponent = ({ onSubmit, error, schema }: AgentSessionInputComponentProps) => {
    const form = useForm({
        resolver: zodResolver<any, any, any>(schema),
        // defaultValues: props.defaultValues,
    })

    return <Form {...form}>
        { error && <Alert variant="destructive" className="mb-4">
            <AlertCircleIcon className="h-4 w-4" />
            <AlertDescription>{error.message}</AlertDescription>
        </Alert> }
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AVFormField
                name="product_id"
                label="Product ID"
                control={ProductSelect}
            />
            <Button type="submit">Submit</Button>
        </form>
    </Form>
}