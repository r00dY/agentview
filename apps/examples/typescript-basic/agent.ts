import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createStandardClient, AgentViewError } from "agentview";
import { OpenAI } from 'openai';
import { cors } from 'hono/cors';

const app = new Hono();
const client = new OpenAI()

const av = createStandardClient()

app.use('*', cors({
  origin: ['http://localhost:1989'],
  credentials: true,
}))

app.post('/simple_chat', async (c) => {
  const { id, token, input } = await c.req.json();

  // Create a new user or authenticate if token exists.
  const user = token ? 
    await av.getUser({ token }) : 
    await av.createUser();

  // Create new session or fetch existing one and authorize user's access to the session.
  const session = id ?
    await av.as(user).getSession({ id }) : 
    await av.as(user).createSession({ agent: "simple_chat" });

  // Create a new run
  // 1. session is now locked - no more runs can be started until this one finishes.
  // 2. will error if session version is semver-incompatible.
  const run = await av.createRun({ 
    sessionId: session.id, 
    items: [input], 
    version: "0.0.1"
  });

  let response : Awaited<ReturnType<typeof client.responses.create>>;

  try {
    // Here you write your stateless AI agent logic.
    response = await client.responses.create({
      model: "gpt-5-nano",
      reasoning: {
        effort: "low",
        summary: "detailed"
      },
      // session.items has all the previous items from the session
      input: [...session.items, input]
    });

  } catch (error) {

    // Mark run as failed and save error message
    await av.updateRun({
      id: run.id,
      status: "failed",
      failReason: {
        message: (error as Error).message,
      }
    });

    throw error;
  }

  // Mark run as completed and save output items
  await av.updateRun({
    id: run.id,
    status: "completed",
    items: response.output
  });

  return c.json({
    id: session.id,
    output: response.output,
    token: user.token,
  })
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
