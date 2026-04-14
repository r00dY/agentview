import {
    processUIMessageStream__modified,
    createStreamingUIMessageState,
    type StreamingUIMessageState,
  } from './processUIMessageStream';
import { parseUIMessageChunk } from './parseUIMessageChunk';
import type { UIMessage } from "ai";


export function createState(messageId: string): StreamingUIMessageState<UIMessage> {
    return createStreamingUIMessageState({
        lastMessage: undefined,
        messageId,
    });
}

export function processEvent2(args: {
    state: StreamingUIMessageState<UIMessage>;
    data: string;
}) {
    const { state, data } = args;

    const chunk = parseUIMessageChunk(data);

    processUIMessageStream__modified({
        state,
        chunk,
        write: () => {},
        onError: (err) => {
            throw err;
        }
    })
}
