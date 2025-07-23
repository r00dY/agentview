# Orchestration - streaming, resuming, cancelling, etc.

Each thread is composed of items and items are created via runs.

Each run is a call to the stateless agent endpoint (right now `run` function in `agentview.config.ts`).

Each run will produce at least 1 item (otherwise it wouldn't make sense), but can produce more. The nature of AI agents is that the tasks might be long running, so streaming support is must-have.

There are 2 kinds of streaming:
- streaming full items one by one (quite easy)
- streaming parts of items (message chunks, thinking tokens, tool parameters etc.)

I'd argue that streaming message chunks is the most important.

## Thread states

**There can be only one active run for a thread**. I don't know if this assumption will make it to the future but let's simplify for now.

So we have 3 thread states:
- `idle` (no run is in progress)
- `failed` (no run is in progress and last run failed)
- `in_progress` (run is running)


## API

I'm very much into the API which is not super granular and allows for quickly asking the current state, replacing all state and having a correct state in the front-end.

That's the purpose of `/threads/{thread_id}` endpoint. It always returns:
- thread properties
- activities
- thread state

We could imagine that each operation in the backend could return this whole structure, we could updated it in the front-end and voila - all works.

But it's not that easy - with streaming we get enormous amount of events and we must send "deltas" to the front-end, otherwise it would be completely impractical.

This can be achieved via `/threads/{thread_id}/watch` which send SSE events about thread changes:
- new activities added
- thread state changes

Front-end should take those deltas and apply them to local state safely.

`/threads/{thread_id}/watch` has a very important query param: `last_activity_id`. It says that all items starting from (and including) `last_activity_id` should be streamed.

### Important assumptions

1. We're not storing event "deltas" in the backend so we can't replay them. This makes storage smaller and architecture much simpler. Whenever stateless agent endpoint emits delta event, we first append it to our already existing item in db and then send this event via pub/sub. If there's any open HTTP connection listening to such an event, it might consume the delta and stream it to the user.
2. Challenge: what if connection drops in front-end? After it is restored, some deltas might be gone and the local state would be incorrect.
3. This implies a **super important assumption**: teh `/watch` endpoint always starts with ENTIRE ACTIVITY (`last_activity_id`, might be incomplete) and only after starts sending remaining deltas.
4. This makes front-end life so much easier as it allows trivial state restoration. Basically front-end should remove last activity and replace it with new events coming from server which results in fully coherent state.

Actually, each time user makes a call to the `/watch`:
1. Every activity is started from the very beginning, we never start with streaming activity starting half-way.
2. Let's assume the first activity coming from event has id `abcd`. In that case local storage of `abcd` should be removed and ALL ACTIVITIES AFTER THAT.

It allows for a fully consistent local state. 

And there won't be any UI glitches / blinks. The first chunk of the first message will be always as big or even bigger (if some deltas were appended) than current local state. So replacing is safe without glitches. 

### Failed state - POST new item

Thread might have items from last failed run. It makes UX better, in case of error we don't suddenly hide anything that was generated but gracefully keep what was dispalyed + show an error.

But what happens when we add a new item in that case?

Actually I think there are a couple of **failed state continuation strategies**:

1. Completely block new items forever (not interesting).
2. Start over from the last correct item. 
3. There could be even strategy that allows for POSTing new activites when thread is `in_progress`. That could cancel current run and create a new run with 2 concatenated user messages as input. Nice UX!

Right now we have strategy 2, ignoring 1 or 3. Let's keep it simple.

#### Problem

The issue is that when we POST activity we should discard previous failed messages - how? They're already in local state, how should front-end behave here. Front-end might not even know the "strategy" and the state should be driven from backend, front-end shouldn't drive the logic.

Right now, if you sent new item to failed thread, and get 200 response, and then make `/watch?last_message_id={last_failed_id}` it will fail. It's because `last_failed_id` is already gone, it "doesn't exist". It was discarded by our strategy of discarding failed items.

The best way to go around it? Before `/watch` just get a fresh thread state, or...

Actually for simplification each `POST` sends new thread state so that client can just `setState(thread)` and it's all up-to-date. Running `/watch` from that point is perfectly allowed. 

IDEA: maybe `/watch` should send fresh state at the beginning? Idk... probably unnecessary.


## Architecture

Each POST of activity triggers a "job" that is running even when connection is lost.

This job saves to the DB, which is THE ONLY SOURCE OF TRUTH.

`/watch` event can listen to changes from that job and stream them to the user. Right now it's done by polling, but it should be done by pub/sub (too many events to do it other way. But it's trivial).

Each delta will:
1. be appended to the item in db
2. sent via pub/sub.

If any connection is listening it will send delta. If not, then well... ignore it. The appeneded data will be send when new `/watch` connection is opened anyway, so nothing is lost.

