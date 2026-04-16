export async function POST() {
  const encoder = new TextEncoder();
  const messageId = `msg_${crypto.randomUUID()}`;
  const textId1 = `txt_${crypto.randomUUID()}`;
  const textId2 = `txt_${crypto.randomUUID()}`;

  const parts = [
    { type: "start", messageId },
    { type: "start-step" },
    // Data parts
    { type: "data-weather", data: { location: "San Francisco", temperature: 18 } },
    { type: "data-status", data: { progress: 100, message: "Analysis complete" } },
    // First text part
    { type: "text-start", id: textId1 },
    { type: "text-delta", id: textId1, delta: "Here is the " },
    { type: "text-delta", id: textId1, delta: "first text part." },
    { type: "text-end", id: textId1 },
    { type: "error", errorText: "gówno"},
    // Second text part
    { type: "text-start", id: textId2 },
    { type: "text-delta", id: textId2, delta: "And here is " },
    { type: "text-delta", id: textId2, delta: "the second text part." },
    { type: "text-end", id: textId2 },
    { type: "custom", kind: "dupa.dupa" },
    { type: "finish-step" },
    { type: "finish" },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
        await new Promise((r) => setTimeout(r, 100));
      }
      // controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
