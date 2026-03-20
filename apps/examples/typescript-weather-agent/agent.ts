import { serve } from '@hono/node-server';
import { Runner } from "@openai/agents";
import { createStandardClient, AgentViewError } from "agentview";
import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { weatherAgent } from './src/weatherAgent';

const app = new Hono();
const av = createStandardClient()

app.use('*', cors({
  origin: ['http://localhost:1989', 'http://127.0.0.1:1989'],
  credentials: true,
}))

app.post('/weather-chat', async (c) => {
  const { id, token, input } = await c.req.json();

  // Create a new user or authenticate if token exists.
  const user = token ?
    await av.getUser({ token }) :
    await av.createUser();

  // Create new session or fetch existing one and authorize user's access to the session.
  const session = id ?
    await av.as(user).getSession({ id }) :
    await av.as(user).createSession({ agent: "weather-chat" });

  // Create a new run
  // 1. session is now locked - no more runs can be started until this one finishes.
  // 2. will error if session version is semver-incompatible.
  const run = await av.createRun({
    sessionId: session.id,
    items: [input],
    version: "0.0.1"
  });

  const runner = new Runner();
  const result = await runner.run(
    weatherAgent({ userLocation: session.metadata?.userLocation }),
    [...session.items, input],
    {
      stream: true,
    }
  );

  return streamSSE(
    c,
    async (stream) => {
      for await (const event of result) {
        if (event.type === 'run_item_stream_event') { // new item available
          const item = event.item.rawItem;

          // emit item to the client
          await stream.writeSSE({
            data: JSON.stringify(item),
            event: 'item.created',
          });

          // save item to AgentView
          await av.updateRun({
            id: run.id,
            items: [item],
          });
        }
      }
      
      const inputTokens = result.rawResponses.reduce((acc, rawResponse) => acc + rawResponse.usage?.inputTokens, 0);
      const outputTokens = result.rawResponses.reduce((acc, rawResponse) => acc + rawResponse.usage?.outputTokens, 0);

      await av.updateRun({ // complete the run
        id: run.id,
        metadata: {
          usage: {
            inputTokens,
            outputTokens
          }
        },
        status: "completed"
      });
    },
    async (error, stream) => { // send error event on error
      console.error('error: ', error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          message: 'Error occured',
        }),
        event: 'error',
      });
      stream.close();
    }
  );
})

// Errors from AgentView SDK are ready to be returned via HTTP with correct status code and body.
app.onError((error, c) => {
  if (error instanceof AgentViewError) {
    return c.json({ ...error.details, message: error.message }, error.statusCode as any);
  }
  throw error;
});

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Agent API server is running on http://localhost:${info.port}`)
})
