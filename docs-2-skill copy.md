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
  reason: z.any().nullable().optional(),
```

#### `session.messages`

The main property is `session.messages`. AgentView uses AI-SDK `UIMessage[]` format for persistence.

`messages` array is always interleaving user message with assistat message: `[user, assistant, user, assistant, ...]`. No other shape is possible.

Sending `user` message triggers a "Run", which ends with assistant message.

Each assistant message contains special metadata property called `_agentview` that contains the additional info about the run that comes from AgentView:
- `id` - run id
- `status` - `in_progress`, `cancelled`, `error`
- `reason` - available for `error` status
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







# --- old --- 




### Create first AI run

```tsx
const user = await client.users.create({ email: "bob@acme.com", name: "Bob" })
const session = await client.sessions.create({ userId: user.id, agent: "weather-agent" })
const sessionUpdated = await client.sessions.createRun(session.id, { 
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

In the first line we created a `User`. Users are first-class object in AgentView, each session *must* belong to some user.

Then we created a new session for our `weather-agent`. Please keep in mind the agent must be in `agentview.config.tsx` to make it work.

In the last line we started an AI run by sending an input to our session. AgentView is using AISDK `UIMessage[]` and Stream Protocol as data layer so the input must be correct `UIMessage` (must have role `user`). **The run is running in the background**, even if you close a browser tab or kill a process.

Here's how it works. Under the hood AgentView registers new user message for `weather-agent`. It knows from the config that `weather-agent` lives in `"http://localhost:3000/api/weather-chat"` URL (called **agent endpoint**). AgentView creates a persistent connection to the Agent Endpoint and send a `Session` object.

Here's how simple weather-chat endpoint could look:

```ts
// app/api/weather-chat/route.ts

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

`Session` object is the same as in SDK. Here's the list of Session properties:

| Property    | Type                                   | Description                                                                                       |
|-------------|----------------------------------------|---------------------------------------------------------------------------------------------------|
| id          | string                                 | Session ID (unique identifier)                                                                    |
| userId      | string                                 | ID of the user who owns this session                                                              |
| agent       | string                                 | The agent's key (matches the name from your agentview.config.tsx)                                 |
| status      | "in_progress" \| "idle" \| "cancelled" \| "failed" | Current state of the session                                                                      |
| **messages**   | UIMessage[]                            | Array of all messages in the session, including user inputs and agent replies                     |
| resume      | boolean                                | Indicates if the session can be resumed                                                           |
| state       | any (nullable, optional)               | Agent specific state or context object (if any, can be null)                                      |
| reason  | any (nullable, optional)               | Failure reason if the session/run failed                                                          |
| createdAt   | string (ISO timestamp)                 | When the session was created                                                                      |
| updatedAt   | string (ISO timestamp)                 | When the session was last updated                                                                 |
| [metadata]  | object (optional)                      | Any additional agent/session metadata (custom or system injected)                                 |

#### Agent Endpoint

When you start a run, AgentView appends user message to `session.messages` array and sends the full `Session` object as a `session` property of the JSON payload.

AgentView expects Agent Endpoint to do one of 2 things:
1. Stream response tokens with AI SDK Stream Protocol 
2. **Return error response**. In this scenario AgentView API just pipes the error back to the user. TS SDK would throw `AgentViewError` with all the details of the response. The state of the session in the backend is not changed.

This architecture **decouples generating response from infrastructure**. You keep a huge flexibility in terms of how you build your agent, but don't have to handle infra at all. Persistence and resumability work out of the box without any extra tricks.

// TODO:
- tell about assistant message being produced
- `_agentview` property (errors, status etc)

#### Consuming Stream





#### Session State

AgentView introduces a concept of "Session state". A state that is shared between runs, and remembered in a session timeline. Going back 







#### Users

AgentView has first-class User entity. Every session must belong to a user. Here's how you can create a user:

```tsx
const bob = client.users.create({ email: "bob@acme.com", name: "Bob" })
const alice = client.users.create({ externalId: "alice-external-platform-id", name: "Alice" })

// Browser
const anonUser = client.users.createAnon()
```

User entity is trivially simple, it has following properties:

- `email` (unique) - email of the user
- `externalId` (unique) - identifier of the user in external platform (usually your users live in other platform, `externalId` is the unique identifier from it to identify users correctly)
- `name` - (display purposes) user's name, just for the purpose of nice display in Studio
- `headline` - (display purpose) 1-liner displayed near name ("Founder of Acme Ltd.")
- `details` - (display purpose) a unstructured "bag" of info about user
- `space` and `ownerId` - space, explained below

Public client (browser facing) cannot set uniquely identifiable properties like `email` or `externalId`.

// `as(user)` !!! 

#### Spaces

Every agent needs a playground. AgentView handles this via concept of Spaces.

Each User belongs to a space, there are 3 spaces: `production`, `playground` and `shared-playground`. 

`production` - 


#### Sessions and Runs

Create an agent session and start a run.

// TODO: describe session shape. Tell about UIMessage[] array.
// Tell about how it *injects* our internal metadata (like status, reason etc)

```tsx
const bob = await client.users.create({ email: "bob@acme.com", name: "Bob" })
const session = await client.sessions.create({ userId: bob.id, agent: "weather-chat" })

await client.sessions.createRun({ sessionId: session.id, input: { parts: [...]}})

// the response is being produced in the background
```

You can create a session & run in one call. It's kind of like a db transaction, if any part of the call fails, no resource is created.

```tsx
const session = await client.sessions.create({ 
  userId: bob.id, 
  agent: "weather-chat",
  input: { parts: [...] }
})
```

`Session` object has `messages` property that holds `UIMessage` array.

#### `useChat`

The best way to consume stream in web is to use `useChat` from AI SDK. 

// useChat example

#### Session state

Each sesssion has `state`. State belongs to the session and not to the specific message.

You can define shape of the state in your config:

```tsx
import { defineConfig } from "@agentview/studio";

export default defineConfig({
  publicApiKey: process.env.NEXT_PUBLIC_AGENTVIEW_API_KEY!,
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
  agents: [
    {
      name: "weather-chat",
      version: "0.0.1",
      url: "http://localhost:3000/api/weather-chat",
      state: z.object({
        userLocation: z.string()
      })
    }
  ]
});
```

Now you can create a session with initial state:

```tsx
const session = await client.sessions.create({ 
  userId: bob.id, 
  agent: "weather-chat",
  initialState: {
    userLocation: "Warsaw"
  }
})
```

If you don't set initial state the API call is gonna throw.

**Setting state**

You change the session state by sending `data-agentview-state` data part in the stream:

```tsx
writer.write({
  type: 'data-agentview-state',
  data: { userLocation: "London" }
});
```

State is time-aware. It knows the moment where you set state, so if you branch your conversation earlier it's gonna get back to the state that as active back at the last message from which you branched.

#### Cancellation

AgentView keeps your run alive even if you drop the connection. Here's how you can cancel:

```tsx
await client.sessions.cancel({ sessionId: session.id })
```

Like Claude/ChatGPT this function doesn't immediately cancel the stream in the front-end. It sends the signal to the backend to cancel the stream and when it's acknowledged, the current streams will abort with `{ type: "abort" }` data part in the Stream.


#### Versions


#### First-class email integration

(channels, _channelMessages)



### Studio

