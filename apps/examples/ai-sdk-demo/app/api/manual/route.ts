export async function POST() {

  // return new Response('Something went wrong', {
  //   status: 400,
  //   headers: { 'Content-Type': 'text/plain' },
  // });

  const encoder = new TextEncoder();
  const messageId = `msg_${crypto.randomUUID()}`;
  const textId1 = `txt_${crypto.randomUUID()}`;
  const textId2 = `txt_${crypto.randomUUID()}`;

  const DELTA = 100;

  const deltasFor20s = Array.from({ length: 20 * 1000 / DELTA }, (_, i) => ({ type: "text-delta", id: textId1, delta: `.${i} ` }));

  const parts = [
    // { type: "data-xxx", data: { whatever: "blablabla" } },

    { type: "start", messageId },
    { type: "start-step" },

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

    // First text part
    { type: "text-start", id: textId1 },
    { type: "text-delta", id: textId1, delta: "Here is the " },
    { type: "text-delta", id: textId1, delta: "first text part." },

    // ...deltasFor20s,

    { type: "text-end", id: textId1 },
    // { type: "error", errorText: "This is some error from the stream part"},
    // { type: "dupa" }, // incorrect chunk
    
    // Second text part
    { type: "text-start", id: textId2 },
    { type: "text-delta", id: textId2, delta: "And here is " },
    { type: "text-delta", id: textId2, delta: "the second text part." },
    { type: "text-end", id: textId2 },
    // { type: "custom", kind: "dupa.dupa" },
    { type: "finish-step" },
    { type: "finish" },
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
