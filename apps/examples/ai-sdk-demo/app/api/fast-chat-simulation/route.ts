const DURATION_MS = 5_000;
const DELTAS_PER_SECOND = 100;
const INTERVAL_MS = 1000 / DELTAS_PER_SECOND;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const LOREM = [
  "Lorem ",
  "ipsum ",
  "dolor ",
  "sit ",
  "amet, ",
  "consectetur ",
  "adipiscing ",
  "elit. ",
  "Sed ",
  "do ",
  "eiusmod ",
  "tempor ",
  "incididunt ",
  "ut ",
  "labore ",
  "et ",
  "dolore ",
  "magna ",
  "aliqua. ",
  "Ut ",
  "enim ",
  "ad ",
  "minim ",
  "veniam, ",
  "quis ",
  "nostrud ",
  "exercitation ",
  "ullamco ",
  "laboris ",
  "nisi ",
  "ut ",
  "aliquip ",
  "ex ",
  "ea ",
  "commodo ",
  "consequat. ",
];

export async function POST() {
  const encoder = new TextEncoder();
  const messageId = `msg_${crypto.randomUUID()}`;
  const textId = `txt_${crypto.randomUUID()}`;

  const totalDeltas = Math.floor((DURATION_MS / 1000) * DELTAS_PER_SECOND);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (part: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
      };

      send({ type: "start", messageId });
      send({ type: "start-step" });
      send({ type: "text-start", id: textId });

      for (let i = 0; i < totalDeltas; i++) {
        const delta = LOREM[i % LOREM.length];
        send({ type: "text-delta", id: textId, delta });
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
      }

      send({ type: "text-end", id: textId });
      send({ type: "finish-step" });
      send({ type: "finish" });

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
      ...CORS_HEADERS,
    },
  });
}
