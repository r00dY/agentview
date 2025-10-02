import type { DisplayComponentProps } from "~/types";
import { Badge } from "./ui/badge";
import { marked } from "marked";

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

function newLinesIntoBr(text: string) {
    return text
        .split('\n')
        .map(line => line.trim())
        .join('<br>')
}


export function ItemUserMessageComponent({ value, options }: DisplayComponentProps<string>) {
    return <div className="relative pl-[10%]">
        <div className="border p-3 rounded-lg bg-white">
            <div
                dangerouslySetInnerHTML={{
                    __html: newLinesIntoBr(value)
                }}
            ></div>
        </div>
    </div>
}

// export function ItemAssistantMessageComponent({ value, options }: DisplayComponentProps<string>) {
//     return <div className="relative pr-[10%]">
//         <div className="border p-3 rounded-lg bg-muted">
//             <div className="prose prose-ul:list-disc prose-ol:list-decimal prose-a:underline" dangerouslySetInnerHTML={{__html: marked.parse(value, { async: false })}}></div>
//         </div>
//     </div>
// }

export function ItemAssistantMessageComponent({ value, options }: DisplayComponentProps<string>) {
    return <div className="pt-2 prose prose-ul:list-disc prose-ol:list-decimal prose-a:underline" dangerouslySetInnerHTML={{__html: marked.parse(value, { async: false })}}></div>
}


// import { z } from "zod";

// function test_zod(schema: z.ZodString, x: string) {
//     return schema.parse(x)
// }


// function test_zod2<S extends z.ZodType<string>>(schema: S, x: string) {
//     // you can safely parse to string here
//     type Out = z.output<S>; // string
//   }


// function test_zod3(schema: z.ZodStringFormat, x: string) {
//     return schema.parse(x)
// }

//   type X = z.ZodUUID;

// type X2 = ReturnType<typeof z.string>;
// type X3 = ReturnType<typeof z.email>;


// test_zod(z.string(), "test")
// test_zod(z.string().min(10), "test")
// test_zod(z.email(), "test") // wrong!!!

// test_zod(z.number(), "test")
// test_zod(z.boolean(), "test")

// test_zod2(z.string(), "test")
// test_zod2(z.string().min(10), "test")
// test_zod2(z.email(), "test") // wrong!!!
// test_zod2(z.uuid(), "test")

// test_zod2(z.number(), "test")
// test_zod2(z.boolean(), "test")

// test_zod3(z.string(), "test")
// test_zod3(z.string().min(10), "test")
// test_zod3(z.email(), "test") // wrong!!!
// test_zod3(z.uuid(), "test")

// test_zod3(z.number(), "test")
// test_zod3(z.boolean(), "test")
