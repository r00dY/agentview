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
const userClient = publicClient.asUser({ token });
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
  id: z.string(),

  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),

  agent: AgentRefSchema.nullable(),

  messages: z.array(UIMessageSchema),
  isRunning: z.boolean() // is currently a run in progress

  metadata: z.record(z.string(), z.any()).nullable(),
  state: z.any().nullable().optional(),

  title: z.string().nullable(),

  user: UserSchema,
  userId: z.string(), // potential bloat, but it's actually ok

  active: z.boolean(),

  channelThread
  channel

```

#### `session.messages`

The main property is `session.messages`. AgentView uses AI-SDK `UIMessage[]` format for persistence.

`messages` array is always interleaving user message with assistat message: `[user, assistant, user, assistant, ...]`. No other shape is possible.

Sending `user` message triggers a "Run", which ends with assistant message.

Each assistant message contains special metadata property called `_agentview` that contains the additional info about the run that comes from AgentView:

```ts
[
  // ...previous session.messages
  {
    id,
    role: "assistant",
    parts: [
      /* ... */
    ],
    metadata: {
      // ... your metadata
      _agentview: {
        id,
        status,
        reason,
        createdAt,
        finishedAt,
        agent: { name, version },
        metadata
      }
    }
  }
]
```

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

AgentView requires `[DONE]` to be sent at the end of the stream. If `[DONE]` is not sent, it will treat the stream as unfinished and leave it in the error state.

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
- `reason` - available for `error` status
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

### First-class email integration

AgentView comes with a built-in seamless email integration (other channels will come soon).

After you run `npx agentview dev` **you can email your agent without any extra work**. Just write an email to `{org-slug}.{env-slug}.{agent-name}@agent.agnetview.app`.

You can check your email address by calling CLI:

```bash
% npx agentview env

   AgentView 0.1.13
   - Organization: acme
   - Environment: local-admin
   - E-mail: acme.local-admin.[agent-name]@agent.agentview.app
```

Here's what AgentView does under the hood when you send an email:
1. Extracts user info from the footer, adds or updates `User` if necessary.
2. Transforms email content (HTML & text) into markdown.
3. For new email thread creates a new Session with `title` being email subject. For existing threads, just locates existing `Session`.
4. If there's any run being active (agent is responding to previous message), it's killed. If there's any outgoing message delivery in progress, it waits until we know whether outgoing message was correctly dispatched.
5. New run is created with all the messages that were unanswered by agent.
6. The `input` of the new run is a single `text` part with all the unanswered messages concatenated, with metadata about authors.
7. The `input` provides `metadata._channelMessages` with an array of channel messages so you can override the default concatenation algorithm in your Agent Endpoint.
8. AgentView analyses output parts and extracts all the `text` parts that go after the last step (tool call, reasoning, etc).

In most cases you can just use default and never think of the details.

If you want to override input with your own custom message, just make a transformation and send different input to the model. Here's `user`message you get from AgentView:

```ts
{
  id: "...",
  role: "user",
  parts: [
    {
      type: "text",
      text: "(all unanswered messages concatenated with metadata about authors)"
    }
  ],
  metadata: {
    _channelMessages: [
      {
        text: "hello how are you?"
        authorEmail: "bob@acme.com"
        authorName: "Bob"
        authorHeadline: "CEO of Acme"
        authorDetails: null
        providerData: { email: { /** email data **/ } }
        date: "2026-05-29T12:14:51.07766+00:00"
      },
      // ...
    ]
  }
}
```

It's also possible to override output. Just send `data-agentview-output` data part to the stream:

```ts
writer.write({
  type: 'data-agentview-output',
  data: "Here's my custom reply"
});
```

This whole system fully synchronises channel state with AI session state, which allows you for **full utilization of prompt caching**.



## Studio

AgentView comes with a Studio, a full-featured UI for displaying agent data. It's comes as a React package, to provide maximum customisation. `agentview.config.tsx` provides entry points which allows you customise how agent session items are displayed, session cards, input components, custom pages, scores etc.

How you "look at the data" is super important. AgentView doesn't fight observability tools, it's a admin panel for non technical users focused on beautiful easy to digest data entry.

[TODO: describe UI]

### Session - Display Properties

The most important view in the system is the view of the AI Session. Similar to Notion document, each Session dislays a list of property - value entries at the top of the session view. By default, AgentView displays generic fields: created at, space, channel, user, agent, etc.

We call them "display properties" and you can set your own with `displayProperties`:

```tsx
export default defineConfig({
  agents: [
    {
      name: "weather-chat",
      // ... 

      displayProperties: [
        {
          title: "User Location",
          value: ({ session }) => <span className="bg-gray-900">{ session.metadata?.userLocation }</span>
        }
      ],
    }
  ]
});
```

`value` is just a React component which provides `session` property which is `Session` object.

Display properties are the main engine for displaying custom, domain-specific information about the session, usually dispalyed based on `session.metadata` or `session.state`.

### Session Items

Below the display properties goes the main canvas where we display Session items - user messages, assistant messages etc. They're displayed in the vertical stack (similar to document blocks in Notion).

The user message is always displayed as one item. For the assistant message, each `part` is displayed as a separate block.

**Imporatnt**. Each block is **commentable** in the sidebar (again, like in Notion). Members of the organization can leave comments in the sidebar, mention each other and collaborate whether agent output is good or not.

You can easily provide custom component for each block:

```tsx
export default defineConfig({
  agents: [
    {
      name: "weather-chat",
      // ... 

      run: {
        userMessage: {
          displayComponent: ({ value }) => {
            return <span>CUSTOM: {value.parts?.map((part: any) => part.text).join("\n\n")}</span>;
          },
        },
        assistantMessage: {
          parts: [
            {
              type: "tool-weather",
              displayComponent: ({ value }) => <CustomWeatherWidget value={value} />
            }
          ]
        },
      }
    }
  ]
});
```

You customise assistant message part by providing 

#### Channel Sessions

If a Session was created by channel (for example email), then the input can be the result of one or more input channel messages. In that case AgentView displays Channel messages instead of input, each as a separate block.

### Input Component

Playground is first-class citizen in AgentView. Members of the organization can create playground sessions to play around with an agent (playground sessions are assigned to `playground` or `shared-playground` Spaces).

In order to send message in a playground session, we obviously need an input component. AgentView ships with default one, but you can customise with `inputComponent` in your agent config:

```tsx
export default defineConfig({
  agents: [
    {
      name: "weather-chat",
      // ...

      inputComponent: ({ sendMessage, cancel, isRunning, session }) => <MyCustomInputComponent
        onSubmit={(val) => {
          sendMessage({
            parts: [
              {
                type: "text",
                text: val,
              }
            ]
          })
        }}
        onCancel={cancel}
        isRunning={isRunning}
      />,
    }
  ]
});
```

### New Session Page

When you create a Playground session, AgentView by default creates anonymous user and creates a session with empty `metadata` and `initialState`.

Sometimes it might not be enough, you might want to set metadata/intialState, or pick an existing user, or create user in a specific ways. All those things can be customised with `newSessionComponent` proeprty in agent config.

```tsx
export default defineConfig({
  agents: [
    {
      name: "weather-chat",
      // ... 

      newSessionComponent: NewSessionComponent
  ]
});

function NewSessionComponent({ client, agent, redirectToSession }: NewSessionComponentProps) {
  const [selectedCity, setSelectedCity] = React.useState<string>("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { user } = await client.users.createAnon();
      const session = await client.sessions.create({
        agent,
        active: false,
        metadata: { userLocation: selectedCity },
        userId: user.id
      });

      redirectToSession(session.id);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select value={selectedCity} onValueChange={setSelectedCity}>
        <SelectTrigger>
          <SelectValue placeholder="Select a city" />
        </SelectTrigger>
        <SelectContent>
          {cities.map((city) => (
            <SelectItem key={city} value={city}>
              {city}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit">Create Session</Button>
    </form>
  );
}
```

`newSessionComponent` is basically a React component that will display as a separate *page* after clicking "New Session" button. The job is to use `client` to create user and session and call `redirectToSession` when action is completed sucessfully.

### Run Footer

Each Run (user / assistant messages pair) comes with a Run Footer under the assistant message with extra info and actions.

#### Run details button - display properties

 There's a built-in `Run` button that displays popup with run details. It comes with its own set of Display Properties that can also be extended easily:

```tsx
export default defineConfig({
  agents: [
    {
      name: "weather-chat",
      // ... 

      run: {
        displayProperties: [
          {
            title: "Cost",
            value: ({ assistantMessage, userMessage }) => assistantMessage?.metadata?.cost ?? "unknown"
          }
        ]
      }
    }
  ]
});
```

You can extend this with any info you want.

### Scores

Each member of the organization can comment and collaborate on agent outputs. Sometimes it's nice to provide a structured feedback, aka scores.

Here's how you can add scores:

```tsx
import { multiSelect, select, Colors } from "@agentview/studio";

export default defineConfig({
  agents: [
    {
      name: "weather-chat",
      // ... 

      run: {
        scores: [
          select({
            name: "forecast_accuracy",
            title: "Forecast Accuracy",
            options: [
              { value: "accurate", label: "Accurate", color: Colors.green },
              { value: "partially_accurate", label: "Partially Accurate", color: Colors.yellow },
              { value: "inaccurate", label: "Inaccurate", color: Colors.red },
            ]
          }),
          multiSelect({
            name: "style",
            title: "Style",
            options: [
              { value: "too-long", label: "Too long" },
              { value: "too-brief", label: "Too brief" },
              { value: "confusing", label: "Confusing" },
              { value: "overly-technical", label: "Overly technical" },
            ]
          })
        ],
      }
    }
  ]
});
```

`select` and `multiSelect` are handy helpers to build basic scores faster.

You can build your own scores with custom schemas and custom components. Each score is actually just an object with following properties:

| Prop | Description | Type |
|------|-------------|------|
| `name` | The name of the score | `string` |
| `schema` | The schema of the score | `z.ZodSchema` |
| `inputComponent` | The component to render the input in Scores dialog | `ControlComponent` |
| `displayComponent` | The component to render the display in Comments section | `React.Component<{ value: any }>` |
| `runFooterComponent` | The component to render the action bar below the item display component | `ControlComponent` |

Here's how scores are displayed in the Studio:
1. There's "Scores" button in the Run Footer. It opens a popup where we display a list of scores, using `name` and `inputComponent`.
2. You can add score directly in the Run Footer by using `runFooterComponent`. 
3. Score `displayCompoennt` is a tiny widget displayed in the comments section. It allows easy display of what scores did members of org applied and react to them with mentions, comments etc.

#### Like score

By default, AgentView comes with "Like" component that's the quickest possible feedback of agent session. It's just a score, just built-in.

You can disabled default like with:

```tsx
export default defineConfig({
  agents: [
    {
      // ... 
      run: {
        disableLike: true
      }
    }
  ]
});
```

### Custom Routes

Studio is a React app and you can extend it with your own pages. Each custom route renders inside the standard Studio shell (sidebar + content), and is automatically added as a link in the sidebar under a "Pages" group.

```tsx
import { Book } from "lucide-react";
import { CustomPage } from "./components/CustomPage";

export default defineConfig({
  // ...
  customRoutes: [
    {
      title: <><Book className="size-4" /> <span>Custom Page</span></>,
      path: "/custom-page",
      Component: CustomPage
    }
  ]
});
```

Each custom route has three fields:
- `title` - React node displayed in the sidebar link (use icons + text as needed)
- `path` - URL path under Studio's `basename` (e.g. `/custom-page` renders at `/studio/custom-page` if `basename="/studio"`)
- `Component` - React component rendered when the route is active

Custom routes are not bound to a specific agent and are always visible in the sidebar. Inside the component you have access to the same Studio context (auth, organization, AgentView client via `agentview()`, etc.) as built-in pages.

# -- to do --

4. Missing properties of client (easy, like list sessions, list users, get user etc)

