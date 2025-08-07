The main objects in the system are Clients, Threads and Activities. It's important to realise they can come from multiple sources and based on the source different behaviours are allowed/disallowed. 

Potential sources of activities:
- real clients: external channels like email, whatsapp, web chat, etc.
- admin users: can do test runs in the admin panel OR have special channel (slack) configured to play around with the agent.

## Real Clients vs Admin Users

The Clients / Activities / Threads can be created either by real users or by admin users. Real users activities *must* be done via channels. The Admin Users can create test conversations via admin panel (which is actually API). In the later versions we'll allow for using channels for sending test messages too (but not for now, it requires some extra effort with allowing for 'system messages' for controlling system state apart from just convo).

The Client (and its all activities / threads) can be either test or real. It should have nullable `simulated_by` which is admin user id. If `NULL` -> real user. If not null, it's simulation.

### Admin Users and test activities

It should be easy make simulations. That's why admin users can create new clients / threads. They can do them from scratch OR duplicate current discussions. Each such client has `simulated_by` column.

A couple of rules:
- by default if the user is `alison123` owner of the client, then it's visible only for her. 
- the thread must be "Published" to be visible for others.

The simulations are done via "standard API" (not channels API)

### Real Clients - Channels

The client activities can be sent *only* via channels. The channel can be email, whatsapp, web chat, etc. 

There must be a special `channels` table in the DB that has `id`, `type` (`slack`, `email` etc), `name`, `created_at` and `config` (`JSONB`). Maybe others like `enabled` etc (easy to update in the future). It represents channels that are set up and turned on.

For now we go with single-table solution, we do not split channels into multiple tables, so it might turn out that separate slack channels or emails will have separate rows in `channels` table. 

Of course Client is not directly related to `channel`, as clients might communicate via different threads. But it's interesting to think whether it should be connected to Activity or a Thread:
1. On communicators like Whatsapp / Messenger it's technically always one big thread, even though it might represent different issues (paralell or serial).
2. User might initiate request (open case) via web form, and then continue via email.
3. User might send new email (not by "Reply") related to some case that was discussed in previous email.

I believe that the switch from web form / web chat to email etc is quite common scenario and therefore we shouldn't bind the channel to the Thread and just bind to the Activity.

In reality in most cases it's gonna be the same channel for all activities. The only case when it changes is actually switching from web form / web chat to the email. In that case leaving the chat should trigger sending an email to the user and the integration should understand how to relate email with current thread.

Anyway, let's keep it future-proof and keep activity bound to the channel. It means that `activities` table should have `channel_id` and `external_activity_id` which is unique ID identifying the source of the external message (like Slack message, email etc). `(channel_id, external_activity_id)` is `UNIQUE` and it makes it easy for integration to see whether certain external message was alread "saved" or not (db as a source of truth).

Actually matching of message -> thread is an important concept! Each time the new message pops in to the "inbox", it might come from some channel, but it's not *that* obvious which thread (or even client :O) should it be assigned to (for the above reasons). The message usually contains certain hints: "In-Reply-To" in email (or custom headers), Slack channel, etc etc. So there's a very important element in our system:

```
f(message) => (client, thread)
```

It's basically the function that maps the input message into client and thread. (null, null) is possible (new client / thread) or (existing_client_id, null) -> new thread. (null, xxx) is impossible, threads always have clients. It's probably channel-dependent.

## Copy & Pasting of Clients for Simulation

It should be absolutely possible to create new simulation environments (threads & clients). It should be possible to create simulation from real conversations and other simulations.

Quesiton: should it be copy-paste or should it keep `previous_x` (client, message etc).

1. Keeping previous messages shared means that you can't comment them in new simulation (shared).

## User interface

How to display threads? What's the default sidebar content?

The main primitive to watch for here is **thread**. There are different axes along which we could split threads:
- public / private
- real / simulations
- channel X/Y/Z
- tags... (automatically set by LLM rankers)

I believe there's only one line that is FORCED which is "simulated" vs "real". Real should be seaprate tab at the top, simulated should be in "Dev" group or sth. Also, the simulated ones could be "Your tests" vs "Shared".

We could also think how to split them by "Agent" (there might be multiple agents).
