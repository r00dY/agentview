Agent View is an open-source scaffolding (UI studio + middleware) for conversational agents.

### You own the AI part

Agent View doesn't have any opinion on the AI part of your agent. You provide the stateless endpoint with intelligence that can be built in any framework (LangGraph, CrewAI, Agents SDK, vanilla, etc) or programming language you prefer.

In short, we want AI Engineers be in control of intelligence. 

### Agent View handles the rest

Agent View takes your stateless endpoint and builts everything you need around it.

#### UI Studio

- Conversation viewer 
- Collaborative discussion on agent outputs (Google Docs-style) + scoring - great for working with domain experts
- Users and permissions management
- Easy management of prompts, knowledge bases
- Version management
- "Dev mode" for testing and playing around with agent

UI Studio is built with React and provides almost framework-level customisability. Every conversation item can have its custom view, you can add new screens, and override anything.

#### Storage & Middleware

Agent View provides a server that handles a lot of stuff you probably don't want to worry about:

- Conversation storage
- Clean, standardized **stateful** APIs for integration
- Session management, re‑connects dropped clients, and lets you resume long‑running chats.
- Integrations with channels: email, Slack, Whatsapp, etc. 
- Hand-offs: it must be easy to pass the conversation to human when needed.

## Why?

### The Future is Conversational

Every business will have a conversational agent. AI is making conversation the primary interface again.

### Two Paths to Build One

**SaaS Route**: Fin, Decagon, Sierra, and 100 others. It's a red ocean of undifferentiated tools with vendor lock-in and black-box solutions. Plus, there's no real "secret sauce" - building AI agents is becoming commoditized.

**Custom Code Route**: Full ownership over a strategic asset. But here's the catch - you don't just build the agent. You need the entire scaffolding: conversation management, user permissions, integrations, versioning, and more.

### Agent View Solves the Scaffolding Problem

We give you the complete infrastructure around your AI endpoint. You focus on the intelligence, we handle everything else.