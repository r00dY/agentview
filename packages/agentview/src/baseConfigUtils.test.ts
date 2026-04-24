import { describe, it, expect } from 'vitest'
import { z } from 'zod';
import { type BaseAgentConfig, type BaseRunConfig, type BaseSessionItemConfig } from './baseConfigTypes.js';
import { findItemConfigById } from './baseConfigUtils.js';

// those types here add $id on the session item config level, also tests whether our functions properly infers types :) 
type SessionItemConfig = BaseSessionItemConfig & {
    $id: string;
}
type RunConfig = BaseRunConfig<SessionItemConfig, SessionItemConfig>
type AgentConfig = BaseAgentConfig<RunConfig>

let sessionItemIdCounter = 1;

function createSessionItem(content: any) {
    return {
        id: `${sessionItemIdCounter++}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        content,
        runId: "default_run_id",
        sessionId: "default_session_id",
    }
}

function replace$Id(object: any, value: any) {
    const newObject: Record<string, any> = {}
    for (const key in object) {
        if (object[key] == "$id") {
            newObject[key] = value
        } else {
            newObject[key] = object[key]
        }
    }
    return newObject;
}


function buildSchema(fields: any) {
    const shape: Record<string, any> = {}

    for (const key in fields) {
        if (fields[key] == "$id") {
            shape[key] = z.string().meta({ callId: true })
        } else if(typeof fields[key] === 'string') {
            shape[key] = z.literal(fields[key])
        } else {
            throw new Error(`Invalid field value for ${key}: ${fields[key]}`)
        }
    }
    return z.looseObject(shape);
}

// we added special '$id' property for the sake of assertions
function functionCall($id: string, fields1: any = {}, fields2: any = {}) {

    return {
        definition: {
            $id: `${$id}_call`,
            schema: buildSchema({
                type: "function_call",
                ...fields1,
            }),
            callResult: {
                $id: `${$id}_result`,
                schema: buildSchema({
                    type: "function_call_result",
                    ...fields2,
                }),
            }
        },
        generate: () => {
            const randomId = 'call_' + Math.random().toString(36).substring(2, 7);

            const call = replace$Id({
                type: "function_call",
                arguments: { a: 1, b: 2 },
                ...fields1,
            }, randomId)

            const result = replace$Id({
                type: "function_call_result",
                output: { c: 3 },
                ...fields2,
            }, randomId)

            return {
                call: createSessionItem(call),
                result: createSessionItem(result),
            }
        }
    }
}

function createRunConfig(steps: any[]): RunConfig {
    return {
        input: {
            $id: "input",
            schema: z.looseObject({
                type: z.literal("message"),
                role: z.literal("user"),
                content: z.string(),
            })
        },
        output: [
            {
                schema: z.looseObject({
                    type: z.literal("reasoning"),
                })
            },
            ...steps,
            {
                $id: "output",
                schema: z.looseObject({
                    type: z.literal("message"),
                    role: z.literal("user"),
                    content: z.string(),
                })
            },
        ]
    }
}


const reasoning = () => {
    return createSessionItem({
        type: "reasoning",
        content: "thinking..."
    })
}

describe('agent with 2 function calls / call ids not set up', () => {
    const functionCall1 = functionCall("function1", { name: "function1" }, { });
    const functionCall2 = functionCall("function2", { name: "function2" }, { });

    const runConfig = createRunConfig([
        functionCall1.definition,
        functionCall2.definition,
    ])

    describe('items with 2 consecutive synchronous function calls', () => {
        const call1 = functionCall1.generate();
        const call2 = functionCall2.generate();

        const items = [
            reasoning(),
            call1.call,
            call1.result,
            reasoning(),
            call2.call,
            call2.result,
            reasoning()
        ]

        it('finds call items', () => {
            expect(findItemConfigById(runConfig, items, call1.call.id)?.itemConfig.$id).toBe(`function1_call`);
            expect(findItemConfigById(runConfig, items, call2.call.id)?.itemConfig.$id).toBe(`function2_call`);
        })

        it('can\'t find call results', () => {
            expect(findItemConfigById(runConfig, items, "xxx")).toBeUndefined();
            expect(findItemConfigById(runConfig, items, call1.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, call2.result.id)).toBeUndefined();
        });
    })

    describe('a lot of paralell calls', () => {
        const fun1_call1 = functionCall1.generate();
        const fun1_call2 = functionCall1.generate();
        const fun1_call3 = functionCall1.generate();
        const fun1_call4 = functionCall1.generate();

        const fun2_call1 = functionCall2.generate();
        const fun2_call2 = functionCall2.generate();
        const fun2_call3 = functionCall2.generate();
        const fun2_call4 = functionCall2.generate();

        const items = [
            reasoning(),
            fun1_call1.call,
            fun1_call2.call,
            fun2_call2.call,
            fun2_call1.call,
            
            fun2_call2.result,
            // fun1_call1.result,
            fun1_call2.result,
            fun2_call1.result,

            reasoning(),

            fun1_call3.call,
            fun2_call4.call,
            fun2_call3.call,
            fun1_call4.call,

            fun1_call3.result,
            fun1_call4.result,
            fun2_call3.result,
            // fun2_call4.result,

            reasoning(),
        ]

        it("properly finds calls", () => {
            expect(findItemConfigById(runConfig, items, fun1_call1.call.id)?.itemConfig.$id).toBe('function1_call');
            expect(findItemConfigById(runConfig, items, fun1_call2.call.id)?.itemConfig.$id).toBe('function1_call');
            expect(findItemConfigById(runConfig, items, fun1_call3.call.id)?.itemConfig.$id).toBe('function1_call');
            expect(findItemConfigById(runConfig, items, fun1_call4.call.id)?.itemConfig.$id).toBe('function1_call');
            expect(findItemConfigById(runConfig, items, fun2_call1.call.id)?.itemConfig.$id).toBe('function2_call');
            expect(findItemConfigById(runConfig, items, fun2_call2.call.id)?.itemConfig.$id).toBe('function2_call');
            expect(findItemConfigById(runConfig, items, fun2_call3.call.id)?.itemConfig.$id).toBe('function2_call');
            expect(findItemConfigById(runConfig, items, fun2_call4.call.id)?.itemConfig.$id).toBe('function2_call');
        })

        it("can't find results", () => {
            expect(findItemConfigById(runConfig, items, fun1_call1.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, fun1_call2.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, fun1_call3.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, fun1_call4.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, fun2_call1.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, fun2_call2.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, fun2_call3.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, fun2_call4.result.id)).toBeUndefined();
        })
    })
})


describe('agent with 2 function calls, with ids', () => {
    const functionCall1 = functionCall("function1", { name: "function1", callId: "$id" }, { callId: "$id" });
    const functionCall2 = functionCall("function2", { name: "function2", callId: "$id" }, { callId: "$id" });

    const runConfig = createRunConfig([
        functionCall1.definition,
        functionCall2.definition,
    ])

    describe('items with 2 consecutive synchronous function calls', () => {
        const call1 = functionCall1.generate();
        const call2 = functionCall2.generate();

        const items =[
            reasoning(),
            call1.call,
            call1.result,
            reasoning(),
            call2.call,
            call2.result,
            reasoning()
        ]

        it ('can find calls', () => {
            expect(findItemConfigById(runConfig, items, call1.call.id)?.itemConfig.$id).toBe('function1_call');
            expect(findItemConfigById(runConfig, items, call2.call.id)?.itemConfig.$id).toBe('function2_call');
        });

        it('for tool call -> properly finds associated tool result', () => {
            expect(findItemConfigById(runConfig, items, call1.call.id)?.tool).toMatchObject({
                type: "call",
                hasResult: true
            });   
        })

        it ('can find results', () => {
            expect(findItemConfigById(runConfig, items, call1.result.id)?.itemConfig.$id).toBe('function1_result');
            expect(findItemConfigById(runConfig, items, call2.result.id)?.itemConfig.$id).toBe('function2_result');
        });

        it('for tool result -> properly finds associated tool call', () => {
            expect(findItemConfigById(runConfig, items, call1.result.id)?.tool).toMatchObject({
                type: "result",
                call: {
                    itemConfig: {
                        $id: "function1_call"
                    },
                    content: call1.call.content,
                }
            });

            expect(findItemConfigById(runConfig, items, call2.result.id)?.tool).toMatchObject({
                type: "result",
                call: {
                    itemConfig: {
                        $id: "function2_call"
                    },
                    content: call2.call.content,
                }
            });        
        })


    })

    describe('a lot of paralell calls', () => {
        const fun1_call1 = functionCall1.generate();
        const fun1_call2 = functionCall1.generate();
        const fun1_call3 = functionCall1.generate();
        const fun1_call4 = functionCall1.generate();

        const fun2_call1 = functionCall2.generate();
        const fun2_call2 = functionCall2.generate();
        const fun2_call3 = functionCall2.generate();
        const fun2_call4 = functionCall2.generate();

        const items = [

            reasoning(),

            fun1_call1.call,
            fun1_call2.call,
            fun2_call2.call,
            fun2_call1.call,
            
            fun2_call2.result,
            // fun1_call1.result,
            fun1_call2.result,
            fun2_call1.result,

            reasoning(),

            fun1_call3.call,
            fun2_call4.call,
            fun2_call3.call,
            fun1_call4.call,

            fun1_call3.result,
            fun1_call4.result,
            fun2_call3.result,
            // fun2_call4.result,

            reasoning(),
        ]

        it("finds calls", () => {
            expect(findItemConfigById(runConfig, items, fun1_call1.call.id)?.itemConfig.$id).toBe('function1_call');
            expect(findItemConfigById(runConfig, items, fun1_call2.call.id)?.itemConfig.$id).toBe('function1_call');
            expect(findItemConfigById(runConfig, items, fun1_call3.call.id)?.itemConfig.$id).toBe('function1_call');
            expect(findItemConfigById(runConfig, items, fun1_call4.call.id)?.itemConfig.$id).toBe('function1_call');
            expect(findItemConfigById(runConfig, items, fun2_call1.call.id)?.itemConfig.$id).toBe('function2_call');
            expect(findItemConfigById(runConfig, items, fun2_call2.call.id)?.itemConfig.$id).toBe('function2_call');
            expect(findItemConfigById(runConfig, items, fun2_call3.call.id)?.itemConfig.$id).toBe('function2_call');
            expect(findItemConfigById(runConfig, items, fun2_call4.call.id)?.itemConfig.$id).toBe('function2_call');
        })


        it('for tool calls -> properly finds associated tool result', () => {
            expect(findItemConfigById(runConfig, items, fun1_call1.call.id)?.tool?.hasResult).toBe(false);
            expect(findItemConfigById(runConfig, items, fun1_call2.call.id)?.tool?.hasResult).toBe(true);
            expect(findItemConfigById(runConfig, items, fun1_call3.call.id)?.tool?.hasResult).toBe(true);
            expect(findItemConfigById(runConfig, items, fun1_call4.call.id)?.tool?.hasResult).toBe(true);
            expect(findItemConfigById(runConfig, items, fun2_call1.call.id)?.tool?.hasResult).toBe(true);
            expect(findItemConfigById(runConfig, items, fun2_call2.call.id)?.tool?.hasResult).toBe(true);
            expect(findItemConfigById(runConfig, items, fun2_call3.call.id)?.tool?.hasResult).toBe(true);
            expect(findItemConfigById(runConfig, items, fun2_call4.call.id)?.tool?.hasResult).toBe(false);
        });

        it("finds results", () => {
            expect(findItemConfigById(runConfig, items, fun1_call1.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, fun1_call2.result.id)?.itemConfig.$id).toBe('function1_result');
            expect(findItemConfigById(runConfig, items, fun1_call3.result.id)?.itemConfig.$id).toBe('function1_result');
            expect(findItemConfigById(runConfig, items, fun1_call4.result.id)?.itemConfig.$id).toBe('function1_result');
            expect(findItemConfigById(runConfig, items, fun2_call1.result.id)?.itemConfig.$id).toBe('function2_result');
            expect(findItemConfigById(runConfig, items, fun2_call2.result.id)?.itemConfig.$id).toBe('function2_result');
            expect(findItemConfigById(runConfig, items, fun2_call3.result.id)?.itemConfig.$id).toBe('function2_result');
            expect(findItemConfigById(runConfig, items, fun2_call4.result.id)).toBeUndefined();
        })

        it ('for tool results -> properly finds associated tool call', () => {
            expect(findItemConfigById(runConfig, items, fun1_call1.result.id)).toBeUndefined();
            expect(findItemConfigById(runConfig, items, fun1_call2.result.id)?.tool?.call.content).toMatchObject(fun1_call2.call.content);
            expect(findItemConfigById(runConfig, items, fun1_call3.result.id)?.tool?.call.content).toMatchObject(fun1_call3.call.content);
            expect(findItemConfigById(runConfig, items, fun1_call4.result.id)?.tool?.call.content).toMatchObject(fun1_call4.call.content);
            expect(findItemConfigById(runConfig, items, fun2_call1.result.id)?.tool?.call.content).toMatchObject(fun2_call1.call.content);
            expect(findItemConfigById(runConfig, items, fun2_call2.result.id)?.tool?.call.content).toMatchObject(fun2_call2.call.content);
            expect(findItemConfigById(runConfig, items, fun2_call3.result.id)?.tool?.call.content).toMatchObject(fun2_call3.call.content);
            expect(findItemConfigById(runConfig, items, fun2_call4.result.id)).toBeUndefined();
        });
    });
});