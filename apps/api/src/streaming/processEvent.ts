import {
    processUIMessageStream__fast,
    createStreamingUIMessageState,
    type StreamingUIMessageState,
  } from './processUIMessageStream';
import { parseUIMessageChunk } from './parseUIMessageChunk';
import type { UIMessage } from "ai";

export class StreamUserError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "StreamUserError";
    }
  }

export function createState(messageId: string): StreamingUIMessageState<UIMessage> {
    return createStreamingUIMessageState({
        lastMessage: undefined,
        messageId,
    });
}

export function processEvent(args: {
    state: StreamingUIMessageState<UIMessage>;
    data: string;
}) {
    const { state, data } = args;

    const chunk = parseUIMessageChunk(data);

    processUIMessageStream__fast({
        state,
        chunk,
        write: () => {},
        onError: (err) => {
            throw new StreamUserError((err as Error).message); // we make this error different class to distinguish from unexpected errors
        }
    })
}
