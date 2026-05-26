# AgentView

AgentView is a managed platform for building customer agents. It works under following assuptions:

1. It's built for AI Engineers so that they can build their agent in a totally custom way. When you create a session or continue with new user messages, AgentView makes a call to custom endpoint (essentially a webhook) to generaete new response. You control this endpoint. It must be compatible with AI Stream Protocol, but apart from that you keep full flexibility. It can be TS, Python, it can be framework or custom.
2. AgentView handles "everything around an agent". Persistence, resumability, playground, sessions API, users API, server and browser SDK, sessions, state, versioning, first-class email integration (other channels soon as well!). It also provides powerful extendable Data Viewer, which is shipped as a React package. The members of your organisation can browse sessions, comment, get notified, etc. You can customise any part of the data viewer with custom react components that live in the single configuration file (`agentview.config.tsx`).

It's like a CMS, but for your agent.

## How it works?

### Account and Organization




### Configuration

All the AgentView configuration lives in code, in `agentview.config.tsx` file. Let's define the simplest possible config file:

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
    }
  ]
});
```

We defined `weather-chat` agent, with version `0.0.1`, and said it lives in http://localhost:3000/api/weather-chat endpoint. Whenever you make agentview call to start a session, it will make a request to this endpoint to generate response (you own the endpoint). The endpoint should be compatible with AI SDK Stream Protocol - that's the only requirement.

### Environments

In config you must set `env` aka environment. Each device where you run AgentView is an environment. Local work, preview branch or production are different environments. Each config is applied **per environment** so your production or staging never interferes with local work.

Apply this config with:

```npx agentview config push```

Now the local environment has config uploaded and knows where to look for `weather-chat` agent (your local machine). This command looks for `agentview.config.tsx` in root file of your project. It also requires `AGENTVIEW_API_KEY` to be defined.

The best way to work with AgentView locall is to run: ```npx agentview dev```:

- it watches for config changes and automatically uploads them to the environment
- it spins off local tunnel so that AgentView can reach your local agent endpoint

### Typescript SDK

AgentView provides and API for managing users, sessions and runs. The best way to consume it is via our SDK. For now we have Typescript, Python soon!

#### Installation

```bash
npm install agentview
```

#### Create a client

```tsx
import { createClient } from "agentview"

export const client = createClient({
  apiKey: process.env.AGENTVIEW_SECRET_API_KEY!, // secret key
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
});

// Browser
export const client = createClient({
  apiKey: process.env.NEXT_PUBLIC_AGENTVIEW_PUBLIC_API_KEY!, // public key
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
});
```

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

#### Spaces

Every agent needs a playground. AgentView handles this via concept of Spaces.

Each User belongs to a space, there are 3 spaces: `production`, `playground` and `shared-playground`. 

`production` - 


#### Sessions and Runs

Create an agent session and start a run.

// TODO: describe session shape. Tell about UIMessage[] array.
// Tell about how it *injects* our internal metadata (like status, failReason etc)

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



### Studio

