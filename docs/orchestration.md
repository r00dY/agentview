# Orchestration - streaming, resuming, cancelling, etc.

Each thread is composed of runs which contain items.

Each run is a call to the stateless agent endpoint (right now `run` function in `agentview.config.ts`).

Each run will produce at least 1 item (otherwise it wouldn't make sense), but can produce more. Streaming support is a must-have.

There are 2 kinds of streaming:
- streaming full items one by one (quite easy)
- streaming parts of items (message chunks, thinking tokens, tool parameters etc.)

## Run states

There are 3 allowed run states:
- `in_progress`
- `complete`
- `failed`

**There can be only one active run for a thread**. I don't know if this assumption will hold in the future for long, but let's keep it simple for now.

This implies that all the runs are either in `complete` or `failed` state, and the last run can be additionally in `in_progress` state.

## API

In order to get up-to-date thread state, just call `GET` on `/threads/{thread_id}`. It returns all runs, with their activities. 

If you want your local client state to be up-to-date, just call this endpoint and replace entire state -> voila.

### Problem: streaming

While streaming we get enormous amount of events and we just can't send full thread state each time. We must send "deltas" (data patches) to the client.

This is the role of `/threads/{thread_id}/watch_run` endpoint. It uses SSE to send events notifying client about active run state changes:
- activity changes (inserts)
- state changes

The client should apply SSE deltas to the local state to update it.

### How should client apply deltas from `/watch_run`

The important thing is that we're not storing deltas in the backend, so we can't replay them. This makes storage smaller and architecture much simpler. Whenever stateless agent endpoint emits delta event, we first append it to our already existing item in db and then send the same delta event via pub/sub. If there's any open HTTP connection listening to this delta's thread, it will consume it and stream it to the user.

Challenge: what if client connection drops and reconnects after a while? If we just created new call to `/watch_run` and it would continue sending deltas, then local state would have missing information!

This implies an **important assumption**: the `/watch_run` endpoint **never** starts with sending deltas "from the middle of the message". It **always** replays entire run from start, and first thing it does it stream all the activities. This makes client much easier to build as it allows for trivial state restoration. Essentially, any time clients sees a beginning of new activity from `/watch_run`, it must just remove all the local activities start applying changes again.

The best way is to it is this: whenever you encounter activity with id `xxx` in the run:
1. Try to find this activity in local run. If it exists, replace and remove all that goes after that.
2. If it doesn't exist append. 

It allows for a fully consistent local state.  And there won't be any UI glitches / blinks. The first chunk of the first message will be always as big or even bigger (if some deltas were appended) than current local state. So replacing is safe without glitches. 

### Failed state - POST new item

Thread might have items from last failed run. It makes UX better, in case of error we don't suddenly hide anything that was generated but gracefully keep what was dispalyed + show an error.

But what happens when we add a new item in that case?

Actually I think there are a couple of **failed state continuation strategies** possible:

1. Completely block new items forever (not interesting).
2. Start over from the last correct item (as if previous failed run didn't happen).
3. There could be even strategy that allows for POSTing new activites when thread is `in_progress`. That could cancel current run and create a new run with 2 concatenated user messages as input. Nice UX!

**Right now we have strategy 2**, ignoring 1 or 3. Let's keep it simple.

#### Problem: what should client do with remaining 'failed' runs in local state

Actually, the API returns all runs, even failed ones. Just show only non-failed + the last one (even if it's failed).

## Architecture

Each POST of activity triggers a "job" that is running even when connection is lost. Right now it's running in HTTP server process.

This job saves updates to the DB, which is THE ONLY SOURCE OF TRUTH.

`/watch_run` event can listen to changes from that job and stream them to the user. Right now it's done by polling, but it should be done by pub/sub. The events for standard text streaming are so frequent that I can't imagine polling SQL DB each time a change happens.

The easiest way to do it is this:
1. Delta is emitted from agent stateless endpoint
2. It's appended to the item in DB.
3. At the same time it's emmitted via pub/sub (Redis?)
4. If any connection is listening it will send delta. If not, then well... ignore it, it can be lost. Any time new `/watch_run` is run, it will start emitting from the beginning of the activity, so the changes from the delta will be applied there.


