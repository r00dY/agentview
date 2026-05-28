# AgentView

AgentView is a managed platform for building customer agents. It works under following assuptions:

1. It's built for AI Engineers so that they can build their agent in a totally custom way. When you create a session or continue with new user messages, AgentView makes a call to custom endpoint (essentially a webhook) to generaete new response. You control this endpoint. It must be compatible with AI Stream Protocol, but apart from that you keep full flexibility. It can be TS, Python, it can be framework or custom.
2. AgentView handles "everything around an agent". Persistence, resumability, playground, sessions API, users API, server and browser SDK, sessions, state, versioning, first-class email integration (other channels soon as well!), environments, data viewer. It also provides powerful extendable Data Viewer with collaboration features, which is shipped as a React package. The members of your organisation can browse sessions, comment, get notified, etc. You can customise any part of the data viewer with custom react components that live in the single configuration file (`agentview.config.tsx`).

It's like a CMS, but for your agent.

## Architecture

1. **Backend** - cloud backend accessed via REST API. Requires creating account, organization and generating API Keys. Best accessed by SDK (for now TS, Python soon)
2. **Studio** - a front-end app developers run locally and deploy on a static hosting. It contains config (`a)

collaborative session viewer shipped as `npm` package (`@agentview/studio`). Studio is single page application you render and host on your own, rendered via `<Studio config={config} />` React component.

// to clean up

## Setting up

AgentView ships as a front-end project, which includes Studio (session viewer) and configuration (`agentview.config.tsx`) which is synced with a hosted backend. It can be Vite, Next.js, or whatever you like. In this example we use Next.js scaffolding:

Install Studio package:
```bash
pnpm install @agentview/studio
```

In the top level create `agentview.config.tsx`:

```tsx
import { defineConfig } from "@agentview/studio";

export default defineConfig({
  publicApiKey: process.env.NEXT_PUBLIC_AGENTVIEW_PUBLIC_API_KEY!,
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
  agents: [
    {
      name: "weather-agent",
      version: "0.0.1",
      url: "http://localhost:3000/api/weather-chat",
    }
  ]
});
```

We defined `weather-chat` and told AgentView that agent lives at the `http://localhost:3000/api/weather-chat` endpoint. We call it **"Agent Endpoint"** (it's a statless endpoint that should stream response in AISDK Stream Protocol format). 

Here's how we can render studio in `/studio` URL of next.js app:

```tsx
// app/studio/[[...slug]]/page.tsx
"use client";

import "../studio.css";
import { Studio } from "@agentview/studio";
import config from "@/agentview.config";

export default function StudioPage() {
  return <Studio config={config} basename="/studio" />;
}
```

In order for Studio to render correctly you must make sure Tailwind is installed and load styles:
```css
@import "@agentview/studio/styles.css";
@source "../../node_modules/@agentview/studio";
```

### Environment variables

In order to work with AgentView you're gonna need 3 things:
- public api key
- secret api key
- environment handle

Go to [LINK] to create account. Go to [LINK] and generate your API keys and copy env.

```
AGENTVIEW_SECRET_API_KEY=sk-...
NEXT_PUBLIC_AGENTVIEW_PUBLIC_API_KEY=pk-...
NEXT_PUBLIC_AGENTVIEW_ENV=local-your-user-id
```

### Running AgentView dev server

In order to work with AgentView you must start dev server:

```bash
npx agentview dev
```

It does 2 things:
1. Watches to config changes and uploads them to the AgentView backend.
2. Creates a tunnel to your localhost so that AgentView can reach your local endpoint.

If you want to manually upload the config you can run `npx agentview config push`.

### Environment

The AgentView config is stored PER ENVIRONMENT. `local-user-id` is your local environment. AgentView can handled multiple configurations, production preview branches, local, not to interfere with each other.

Each member of organisation gets its own local environment, there's also `production` environment for deployment (you'll have to run `npx agentview config push` on deploy).


## SDK - Typescript



AgentView provides and API for managing users, sessions and runs. The best way to consume it is via our SDK. For now we have Typescript, Python soon!

### Installation

```bash
npm install agentview
```

### Create a client

```tsx
import { createClient } from "agentview"

// Server
export const client = createClient({
  apiKey: process.env.AGENTVIEW_SECRET_API_KEY!, // secret key
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
});

// Browser
export const publicClient = createClient({
  apiKey: process.env.NEXT_PUBLIC_AGENTVIEW_PUBLIC_API_KEY!, // public key
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
});
```

### Users

AgentView has first-class User entity. Every session must be assigned to a user. Here's how you can create a user:

```tsx
// Server
const { user: unknownUser } = await client.users.create()
const { user: bob } = await client.users.create({ email: "bob@acme.com", name: "Bob" })
const { user: alice } = await client.users.create({ externalId: "alice-external-platform-id", name: "Alice" })

// Browser
const anonUser = client.users.createAnon()
```

`User` object is purposefully very minimal. In most cases users live in external platform, for example if you build shopping assistant your users live in ecommerce platform. The `User` in AgentView is only for organisational purposes and memory, it shouldn't be used as primary source of user data in your system.

Each `User` object has optional `externalId` field, which is **unique** and you can set it to connect AgentView User with the User in your core plaform:

```tsx
await client.users.create({ externalId: "user-id-from-external-platform" }); // create user with external id
const user = await client.users.getByExternalId("user-id-from-external-platform"); // fetch by external id
```

Another property by which you can identify users is email. It's also unique:

```tsx
await client.users.create({ email: "bob@acme.com" });
const bob = await client.users.getByEmail("bob@acme.com");
```

Here's the full list of User properties:
- `email` (unique) - email of the user
- `externalId` (unique) - identifier of the user in external platform (usually your users live in other platform, `externalId` is the unique identifier from it to identify users correctly)
- `name` - (display purposes) user's name, just for the purpose of nice display in Studio
- `headline` - (display purpose) 1-liner displayed near name ("Founder of Acme Ltd.")
- `details` - (display purpose) a unstructured "bag" of info about user
- `space` and `ownerId` - space to which user is assigned, explained below

`name`, `headline` and `details` are for display purposes (especially `name` and `headline`), they also serve context for the model about author of the message.

Our built-in email integration, AgentView parses the email footer and fills `name`, `headline` and `details` automatically.

#### Authorization

If you use AgentView client server-side (initialized with secret api key), you have access to all users within the organization:

```tsx
await client.sessions.list() // all users' sessions
```

AgentView allows to narrow down client scope to the specific user with `asUser` proprety:

```tsx
const bobClient = client.asUser({ id: "bobs-id" })
await bobClient.sessions.list() // bob's sessions
await bobClient.sessions.createRun(aliceSessionId, { input }) // throws! Bob doesn't have access to Alice's session
```

Any operation done with `bobClient` will throw an error if Bob is not authorised for it.

You can also narrow down scope by external id: `client.asUser({ externalId })`.

#### Browser

AgentView client can be used in a browser (or any client). To create public client you must pass public API key:

```tsx
export const publicClient = createClient({
  apiKey: process.env.NEXT_PUBLIC_AGENTVIEW_PUBLIC_API_KEY!, // public key
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
});
```

Obviously, `publicClient` initialized this way can't do much, as it doesn't yet have access to any organisation resources.

In order to authorize public client, you must provide authorization token generated when user is created:

```tsx
// server-side
const { user, token } = await client.users.create({ email: "bob@acme.com" })

// browser
const userClient = publicClient.asUser({ token });
const sessions = await userClient.sessions.list()
```

You can also generate and revoke tokens manually:

```tsx
const token = await client.auth.issueToken(userId); // issue token
await client.auth.revokeToken(tokenId) // revoke token
```

There's often a need for createing agent sessions by anonymous users (not logged in). Public client allows for creating anonymous users:

```tsx
// browser
const { user, token } = await publicClient.users.createAnon()
const userClient = publicClient.as({ token });
const session = await userClient.sessions.create({ agent: "weather-agent" }) // session of anonymous user
```

### Spaces

AgentView comes with first-class playground experience. Playground allows members of organisation to create test sessions that are not treated like production ones. In order to achieve that each User is assigned to a Space.

There are 3 available spaces:
- `production` - production data, created by real users. `ownerId` is always `null` since they're not created by specific organisation member. 
- `playground` - private member's playground. Visible and editable only to the owner (`ownerId` must be defined)
- `shared-playground` - identical to `playground`, but all members of organization can see the session

Space is represented by `user.space` and `user.ownerId` properties.

The default Space assigned when creating a user is determined by client's environment (`X-Env` header in API). If it's Bob's local environment, then by default the User will be assigned to Bob's private playground. If the environment is production, then the space is `production`. It means that if you play around with AgentView API locally, all the resources created will be assigned to your private playground by default.

AgentView Studio allows to create test sessions inside the UI. In this case, each newly created user will be assigned to the private playground of currently logged in member. There's a "Share" button available which allows for sharing the user (with all his sessions), all it does is changing space from `playground` to `playground-shared`.

### Sessions

The core object of AgentView is Session. It represents conversation/thread with AI agent.

Here's how you can create an empty session:

```tsx
const session = await client.sessions.create({ userId: user.id, agent: "weather-agent" })
```

Here are the core fields of a `Session` object:
- `id` - unique session id
- `user` - user owning the session
- `title` - short title of the session -> generated automatically, but can be overriden
- `state` - session state
- `messages: UIMessage[]`
- `metadata`

```
// TODO, cleanup:
  id: z.string(),
  channel: ChannelRefSchema,
  handle: z.string(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  metadata: z.record(z.string(), z.any()).nullable(),
  user: UserSchema,
  userId: z.string(), // potential bloat
  space: SpaceSchema, // this is actually user.space, but allows to "think user-less"
  title: z.string().nullable(),
  agent: AgentRefSchema.nullable(),
  active: z.boolean(),
  channelThreadId: z.string().nullable(),
  messages: z.array(UIMessageSchema),
  resume: z.boolean(),
  status: SessionStatusSchema,
  state: z.any().nullable().optional(),
  failReason: z.any().nullable().optional(),
```

#### `session.messages`

The main property is `session.messages`. AgentView uses AI-SDK `UIMessage[]` format for persistence.

`messages` array is always interleaving user message with assistat message: `[user, assistant, user, assistant, ...]`. No other shape is possible.

Sending `user` message triggers a "Run", which ends with assistant message.

Each assistant message contains special metadata property called `_agentview` that contains the additional info about the run that comes from AgentView:
- `id` - run id
- `status` - `in_progress`, `cancelled`, `error`
- `failReason` - available for `error` status
- `createdAt`
- `finishedAt`
- `agent: { name, version }`
- `metadata` - extra metadata set via API (not as a part of stream)

Most importantly, `_agentview` allows for displaying run status next to the assistant message. AgentView fully supports continuation of a session where the last run had error or was cancelled (similar to Claude or ChatGPT), but retaining this information in UI is valuable. 

#### `session.state`

AgentView introduces extension of `UIMessage[]` array called `state`. State is arbitrary object that is bind to a SESSION, not a message. At each point in time there's only *one state*.

This is very handy in many scenarios:
- if you use a sandbox per session, you might store sandbox snapshot id.
- you might save "session memories".
- keeping compaction boundaries

Here's how you can set initial state:

```tsx
const session = await client.sessions.create({ 
  userId: user.id, 
  agent: "weather-agent", 
  initialState: { userLocation: "Warsaw" }
})
```

Changing state later can be done by streaming `data-agentview-state` data part in the Stream:

```ts
writer.write({
  type: 'data-agentview-state',
  data: { userLocation: "London" }
});
```

AgentView remembers the moment when the state was saved. Whenever you branch conversation from earlier point it will apply state that was available at the branch point.

Apart from `initialState` **you can't modify state via API**.

#### `session.metadata`

Session metadata are similar to state, but they're not time-aware, they're just fields "describing the session". The mental model should be that `metadata` are fields that, if removed, don't change the session behaviour.

You can add a schema for metadata in `agentview.config.tsx`

```ts
export default defineConfig({
  agents: [
    {
      name: "weather-chat",
      // ...

      metadata: {
        userLocation: z.string()
      },
      allowUnknownMetadata: false
    }
  ]
});
```

By default if you didn't define a metafield in metadata, it's allowed to be saved, unless you set `allowUnknownMetadata: false`.

// TODO: how to set etc.

#### `session.title`

Each session gets a title. For API sessions it's generated automatically by AgentView, for emails it's email topic.

You can set title manually when you create a message or update it later via API:

```tsx
const session = await client.sessions.create({ userId, agent: "weather-agent", title: "What did Ilya see?" })
const updatedSession = await client.sessions.update({ title: "Reasoning models capabilities" })
```

#### List sessions

You can list sessions:

```tsx
const { sessions, pagination } = await client.sessions.list()
```

### Sending messages, aka Runs

If you want to send a user message in a session, you must create a "Run". Run represents entire activity between sending the user message and finishing assistant message. Here's how to create a run:

```tsx
const sessionEmpty = await client.sessions.create({ userId, agent: "weather-agent" })
const sessionWithUserMessage = await client.sessions.createRun(sessionEmpty.id, { 
  input: {
    role: "user",
    parts: [
      {
        type: "text",
        text: "Hello, what's the weather in Warsaw now?"
      }
    ]
  }
})
```

Since AgentView uses ai-sdk format for persistence, starting a run requires sending correct `UIMessage` with `role: "user"`.

**What happens under the hood after you create a run is the most important architectural thing about AgentView**.

Here's what AgentView does:
1. Validates user message format, checks whether there's no other run in progress, etc. In any error case -> immediate error response (`AgentViewError` thrown by client).
2. Looks for the config of your environment, and searches for `weather-agent` and its `url`.
3. Prepares new `Session` object with user message appeneded to the end of `meessages` array.
4. **Creates a live persistent connection to the Agent Endpoint** (living in `url`). It works even if you work locally, since `npx agentview dev` creates a tunnel to your local environment.
5. Sends `{ session }` as body.

AgentView expect the Agent Endpoint to send back ai-sdk compatible stream (Stream Protocol). ai-sdk is naturally compatible, but any other framewrok implementing ai-sdk protocol also works (for example Pydantic AI). Here's an example of simple agent endpoint in our Next.js demo app:

```tsx
// apps/api/weather-agent/route.tsx
export async function POST(req: Request) {
  const { messages, session }: { messages: UIMessage[], session: SessionBase } = await req.json();

  const result = streamText({
    model: openai("gpt-5-mini"),
    system:
      `You are a helpful assistant with access to a weather tool. When the user asks about weather, use the tool to get real data. Be concise.`,
    messages: await convertToModelMessages(messages),
    tools: { weather: weatherTool },
    stopWhen: stepCountIs(5)
  });

  return result.toUIMessageStreamResponse();
}
```

That's all. All you need to provide is a **STATLESS AGENT ENDPOINT COMPATIBLE WITH AISDK STREAM PROTOCOL**. No need for thinking of persistence, resumability etc.

#### Error handling

Before making a call to Agent Endpoint Agentview does validations: checks user message shape, looks for agent config, etc. In case of any such error user message won't be saved in the `messages` array, the operation is essentially discarded.

If Agent Endpoint call is made but it returns error response (40x / 50x), the user message also will be discarded. The error from Agent Endpoint is piped directly into API response from AgentView.

#### Input Validation

Given how error handling works, validation is trivial. in AgentView Endpoint you can validate user message (last message in `session.messages`) and if it doesn't pass validation -> just return error response.

#### Connecting to Stream - `useChat`

Since AgentView is based on ai-sdk Stream Protocol the easiest way to consume the stream is to use `useChat`:

```tsx
const { messages, sendMessage, regenerate } = useChat({
    id: session.id,
    messages: session.messages,
    resume: session.isRunning,
    transport: userClient.createTransport(), // it must be user client for user who has access to the session
});
```

It allows you to quickly build your agent UI in any way you want.

Important: chat id **must be** `session.id`. It's how ai-sdk `useChat` passes session identifier to transport under the hood.

The above example assumes you already have Session object available, but of course often you'll start without session. Here's how you can do this:

```tsx
const session : Session | null | undefined = /* session or undefined or null */

const { messages, sendMessage, regenerate } = useChat({
    id: session?.id,
    messages: session?.messages,
    resume: session?.isRunning,
    generateId: () => crypto.randomUUID(),
    transport: userClient.createTransport({
      newSession: {
        agent: "weather-agent",
      }
      onSessionCreated: ({ session }) => { /* ... */ }
    }),
});
```

When `session` is defined, nothing changes compared to previous example. Here's what happens when it's not defined:
1. `id` is empty, so `useChat` generates one automatically. We need to set `crypto.randomUUID()` since it's what AgentView requires for session id.
2. When you run `sendMessage` AgentView creates a session with the id you generated locally with `newSessionParams` as parameters.
3. `onSessionCreated` is called to notify you about new session.
4. Everything continues normally.


#### Connecting to Stream - direct

It might not be needed often but you can connect to chunks stream directly via API:

```tsx
const stream = await client.sessions.getStream(sessionId);

if (stream) {
  for await (chunk in stream) {
    console.log(chunk) // UIMessageChunk
  }
}
else {
  console.log('no active stream')
}
```

#### Creating session and run in a single transaction

Creating empty sessions is not very useful and in most scenarios you'll want to create sessions & first run in "single transaction". If any operation fails, nothing changes in the backend state.

You can do this this way:

```tsx
const session = await client.sessions.create({ 
  userId, 
  agent: "weather-agent", 
  input: { role: "user", parts: [ /*...*/]} 
})
```

#### Stream Protocol - Chunks correctness

AgentView works a middleware between Agent Endpoint and external world. It consumes Stream Protocl chunks and passes them forward to connected clients.

AgentView **validates the stream**. It means that if chunk is badly formatted, or it's semantically incorrect (i.e. tool result before tool call), AgentView will just send error chunk (`{ type: "error", errorText: "error reason" }`) and close the stream.

If run is cancelled by user (see below), then AgentView will send `{ type: "abort" }` and also close the stream immediately.

AgentView requires `[done]` to be sent at the end of the stream. If `[done]` is not sent, it will treat the stream as unfinished and it will also result in an error run.

#### Cancellation

AgentView keeps your run alive even if you drop the connection. Here's how you can cancel:

```tsx
await client.sessions.cancel(session.id)
```

Like Claude/ChatGPT this function doesn't immediately cancel the stream in the front-end. It sends the signal to the backend to cancel the stream and when it's acknowledged, the current streams will abort with `{ type: "abort" }` data part in the Stream. It ensures the backend and frontend state are consistent.

#### Displaying run status in chat history

As mentioned above, each assistant message is extended with `_agentview` field in metadata:

```
- `id` - run id
- `status` - `in_progress`, `cancelled`, `error`
- `failReason` - available for `error` status
- `createdAt`
- `finishedAt`
- `agent: { name, version }`
- `metadata` - extra metadata set via API (not as a part of stream)
```

This is persisted, so you can easily show the exact status of each turn.

#### Continuation of session with cancelled / error runs.

Similar to ChatGPT/Claude AgentView allows to continue sessions even if the previous run had errors or was cancelled.

AgentView makes sure that the `session.messages` state sent to your Agent Endpoint is awalys correct. So even if the run finished with unfinished tool calls, AgentView will clean it up so you can continue comfortably.

#### Branching

You can start a run starting from previous messages (`regenerate`):

```tsx
await client.sessions.createRun(sessionId, { input, previousRunId: runId })
```

`runId` is `_agentview.id`.


#### Versions

Each agent in the config must be version assigned. 

```tsx
export default defineConfig({
  // ...
  agents: [
    {
      name: "weather-agent",
      version: "0.0.1",
      url: "http://localhost:3000/api/weather-chat",
    }
  ]
});
```

Every time you create a session or a run, agentview stores the agent and its version that was active at that moment:

```tsx
console.log(session.agent) // { name: "weather-agent", version: "0.0.1" }

const lastAssistantMessage = session.messages[sessions.messages.length - 1];
console.log(lastAssistantMessage.metadata._agentview.agent) // { name: "weather-agent", version: "0.0.2" }
```

Versions allows for better visibility, but also protects sessions from being continued with incompatible version. AgentView follows semantic versioning convention. You can't create a run in a session where previous run was higher version, or whether new version is a breaking change (major number increased).


#### First-class email integration (CHANNELS)

(channels, _channelMessages)

TBD

### Studio

TBD (configuration of visual builder via custom components)



# -- to do --

1. Channels (`_channelMessages` and channel info in Session object)
2. Clean up Session object!! isRunning / status etc. 
3. Studio -> make it quick god damn it
