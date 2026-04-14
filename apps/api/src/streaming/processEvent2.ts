import {
    processUIMessageStream__modified,
    createStreamingUIMessageState,
    type StreamingUIMessageState,
  } from './processUIMessageStream';
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

    // parse
    const chunk = JSON.parse(data);

    // simplified validation for hot-path (deltas)
    /**
     * TODO!!!!!! VALIDATE CHUNKS!!!!!!!
     */
    if (chunk.type === 'text-delta') {
        // if (typeof chunk.delta !== 'string' || typeof chunk.id !== 'string') {
        //     throw new Error('Invalid text-delta chunk'); // onError???
        // }
    }
    else {
        // validate normally
    }

    processUIMessageStream__modified({
        state,
        chunk,
        write: () => {},
        onError: (err) => {
            throw err;
        }
    })
}
