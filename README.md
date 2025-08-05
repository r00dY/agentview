<div align="center">
  <a href="https://nextjs.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/logo_light.svg" height="40">
      <img alt="Next.js logo" src="docs/logo.svg" height="40">
    </picture>
  </a>
  <br/><br/>
  <!-- <h1>agentview</h1> -->

</div>

Agent View is an open-source UI and middleware layer for building, debugging, and managing your own conversational agents. Framework-agnostic and fully customizable.

### You own the AI part

Agent View stays out of your AI logic. You provide the stateless endpoint with intelligence that can be built in any framework (LangGraph, CrewAI, Agents SDK, vanilla, etc) or programming language you prefer. Agent View keeps AI Engineers in control of the intelligence layer.

### Agent View handles the rest

Agent View takes your stateless endpoint and builts everything you need around it.

#### UI Studio

- View and debug conversations
- Comment collaboratively on agent outputs (Google Docs-style)
- Score outputs with teammates or domain experts
- Manage users, permissions, and teams
- Edit prompts and knowledge bases easily
- Track agent versions
- Test in "dev mode" without writing code

UI Studio is built with React and provides almost framework-level customisability. Every conversation item can have its custom view, you can add new screens, and override anything.

#### Storage & Middleware

Agent View provides a server that handles a lot of stuff you probably don't want to worry about:

- Conversation storage
- Clean, standardized **stateful** APIs for integration
- Session management, re‑connects dropped clients, and lets you resume long‑running chats.
- Integrations with channels: email, Slack, Whatsapp, etc. 
- Hand-offs: it must be easy to pass the conversation to human when needed.

## Why?

Let's start what I believe in:

- AI will make conversation the primary interface (again)
- Every business will have a conversational agent. 
- The conversational agents and how they behave will be of a **strategic** importance.

For now, most of the conversational agents are done by SaaS (Fin, Decagon Sierra and 100 others). However, SaaS has a big problem:
- vendor lock-in + black box, you actually don't have control
- they have no "secret sauce", building agents is not **that hard**, it's mostly good prompts, tools + evals. It requires more services and less products.

I'm product engineer turned AI engineer and built conversational agents for a couple of comapnies. I discvered I spent more time on a good scaffolding than on building agent itself. So well... AgentView! :)

## Project status

⚠️ Still cooking!

Agent View is under active development. It’s not ready for prime time yet, but we’re sharing early to get feedback and build with the community.

