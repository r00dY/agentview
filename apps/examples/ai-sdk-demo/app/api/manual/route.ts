export async function POST(request: Request) {

  // return new Response('Something went wrong in AI endpoint', {
  //   status: 400,
  //   headers: { 'Content-Type': 'text/plain' },
  // });

  const body = await request.json();
  const messages = body.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const copyInput = `copy input: ${JSON.stringify(lastMessage)}`;

  const encoder = new TextEncoder();
  const messageId = `msg_${crypto.randomUUID()}`;
  const textId0 = `txt_${crypto.randomUUID()}`;
  const textId1 = `txt_${crypto.randomUUID()}`;
  const textId2 = `txt_${crypto.randomUUID()}`;

  const DELTA = 100;

  const deltas = (seconds: number) => Array.from({ length: seconds * 1000 / DELTA }, (_, i) => ({ type: "text-delta", id: textId1, delta: `.${i} ` }));

  const parts = [
    // { type: "data-xxx", data: { whatever: "blablabla" } },

    { type: "start", messageId },
    { type: "start-step" },

    { type: "text-start", id: textId0 },
    { type: "text-delta", id: textId0, delta: copyInput },
    { type: "text-end", id: textId0 },

    { type: "reasoning-start", id: "reasoning_1" },
    { type: "reasoning-delta", id: "reasoning_1", delta: "Thinking " },
    { type: "reasoning-delta", id: "reasoning_1", delta: "about " },
    { type: "reasoning-delta", id: "reasoning_1", delta: "the " }, 
    { type: "reasoning-delta", id: "reasoning_1", delta: "first text part " },
    { type: "reasoning-delta", id: "reasoning_1", delta: "and then " },
    { type: "reasoning-delta", id: "reasoning_1", delta: "the second text part." },
    { type: "reasoning-end", id: "reasoning_1" },

    { type: "message-metadata", messageMetadata: { random: crypto.randomUUID() } },

    // Data parts
    { type: "data-weather", data: { location: "San Francisco", temperature: 18 } },

    // // First text part
    // { type: "text-start", id: textId1 },
    // { type: "text-delta", id: textId1, delta: "Here is the " },
    // { type: "text-delta", id: textId1, delta: "first text part." },

    // ...deltas(10),

    // { type: "text-end", id: textId1 },


    // { type: "error", errorText: "This is some error from the stream part"},
    // { type: "dupa" }, // incorrect chunk
    
    // Second text part
    { type: "text-start", id: textId2 },
    { type: "text-delta", id: textId2, delta: "## Good morning\n\n" },
    { type: "text-delta", id: textId2, delta: "And here is the list:\n\n" },
    { type: "text-delta", id: textId2, delta: "1. one\n2. two\n3. three\n\n"},
    { type: "text-delta", id: textId2, delta: "Some **bold** text. " },
    { type: "text-delta", id: textId2, delta: "Random number: " + crypto.randomUUID() + "." },

    { type: "text-end", id: textId2 },

    // { type: "tool-input-start", toolCallId: "tool_call_1", toolName: "getWeatherInformation" },
    // { type: "tool-input-available", toolCallId: "tool_call_1", toolName: "getWeatherInformation", input: { location: "San Francisco", temperature: 18 } },

    // { type: "custom", kind: "dupa.dupa" },

    { type: "error", errorText: "This is some error from the stream part"},

    // { type: "finish-step" },
    // { type: "finish" },

    // { type: "data-agentview-output", data: "gunwo cycki" },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
        await new Promise((r) => setTimeout(r, DELTA));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
      "X-AgentView-Version": "0.0.1",
    },
  });
}
