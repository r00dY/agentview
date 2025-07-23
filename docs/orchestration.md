# Orchestration - streaming, resuming, cancelling, etc.

Each thread is composed of items and items are created via runs.

Each run is a call to the stateless agent endpoint (right now `run` function in `agentview.config.ts`).

Each run will produce at least 1 item (otherwise it wouldn't make sense), but can produce more. The nature of AI agents is that the tasks might be long running, so streaming support is must-have.

There are 2 kinds of streaming:
- streaming full items one by one (quite easy)
- streaming parts of items (message chunks, thinking tokens, tool parameters etc.)

## Thread states

**There can be only one active run for a thread**. I don't know if this assumption will hold in the future for long, but let's keep it simple for now.

So we have 3 thread states:
- `idle` (no run is in progress)
- `failed` (no run is in progress and last run failed)
- `in_progress` (run is running)


## API

In order to get up-to-date thread state, just call `GET` on `/threads/{thread_id}`

It essentially returns:
- thread properties
- a list of all activities
- thread state

This endpoint outputs all the incomplete activities (being streamed right now), failed activities for the last run (hiding them would be an awkward UX).

Essentially if you want your local client state to be up-to-date, just call this endpoint and replace entire state -> voila.

### Problem: streaming

While streaming we get enormous amount of events and we just can't send full thread state each time. We must send "deltas" (data patches) to the client.

This is the role of `/threads/{thread_id}/watch` endpoint. It uses SSE to send events notifying client about thread state changes:
- activity changes (inserts, updates)
- thread state changes

The client should apply SSE deltas to the local state to update it.

### How should client apply deltas from `/watch`

Let's start with what is the first event streamed:
1. If query parameter `last_activity_id` is passed, then this will be the first activity sent in the stream. It can be any activity from the thread. All consecutive activites will be streamed in order.
2. If `last_activity_id` is not defined, then the stream starts with newest activity in the thread. 

The important thing is that we're not storing deltas in the backend, so we can't replay them. This makes storage smaller and architecture much simpler. Whenever stateless agent endpoint emits delta event, we first append it to our already existing item in db and then send the same delta event via pub/sub. If there's any open HTTP connection listening to this delta's thread, it will consume it and stream it to the user.

Challenge: what if client connection drops and reconnects after a while? If we just created new call to `/watch` and it would continue sending deltas, then local state would have missing information!

This implies an **important assumption**: the `/watch` endpoint **never** starts with sending deltas "from the middle of the message". It **always** replays entire activity (`last_activity_id`) from start, first event is all the content that was already produced, and only then deltas start flowing again. This makes client much easier to build as it allows for trivial state restoration. Essentially, any time clients sees a beginning of new activity from `/watch`, it must just remove all the local state back to this activity (included) and start applying changes again.

**Any time `/watch` endpoint emits new activity event, let's assume its id is `xxx`, then the client must find in local state activity `xxx`, remove it entirely with ALL CONSECUTIVE ITEMS, and start applying changes again.

It allows for a fully consistent local state.  And there won't be any UI glitches / blinks. The first chunk of the first message will be always as big or even bigger (if some deltas were appended) than current local state. So replacing is safe without glitches. 

### Failed state - POST new item

Thread might have items from last failed run. It makes UX better, in case of error we don't suddenly hide anything that was generated but gracefully keep what was dispalyed + show an error.

But what happens when we add a new item in that case?

Actually I think there are a couple of **failed state continuation strategies** possible:

1. Completely block new items forever (not interesting).
2. Start over from the last correct item (as if previous failed run didn't happen).
3. There could be even strategy that allows for POSTing new activites when thread is `in_progress`. That could cancel current run and create a new run with 2 concatenated user messages as input. Nice UX!

**Right now we have strategy 2**, ignoring 1 or 3. Let's keep it simple.

#### Problem: what should client do with remaining 'failed' activities in local state

The issue is that when we POST activity we should discard previous failed messages - but how? They're already in local state. I don't think front-end should have any logic hardcoded, the logic of managing thread state should be driven from backend.

So if you send a new item to a failed thread, and get 200 response, and then make `/watch?last_message_id={last_failed_id}` it will fail. It's because `last_failed_id` is already gone, it "doesn't exist", based on strategy 2 of discarding failed activities after new activity POST.

What's the solution? Each `POST` sends in the response new thread state (in the same format as `GET /thread/{thread_id}`). If the client replaces the state, then `/watch` will work flawlessly.

Actually calling `GET /thread/{thread_id}` before each `/watch` wouldn't be silly. I even thought of making `/watch` emit full thread state in the beginning but it seems a bit off.


## Architecture

Each POST of activity triggers a "job" that is running even when connection is lost. Right now it's running in HTTP server process.

This job saves updates to the DB, which is THE ONLY SOURCE OF TRUTH.

`/watch` event can listen to changes from that job and stream them to the user. Right now it's done by polling, but it should be done by pub/sub. The events for standard text streaming are so frequent that I can't imagine polling SQL DB each time a change happens.

The easiest way to do it is this:
1. Delta is emitted from agent stateless endpoint
2. It's appended to the item in DB.
3. At the same time it's emmitted via pub/sub (Redis?)
4. If any connection is listening it will send delta. If not, then well... ignore it, it can be lost. Any time new `/watch` is run, it will start emitting from the beginning of the activity, so the changes from the delta will be applied there.


