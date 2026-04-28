import {
    processUIMessageStream__fast,
    createStreamingUIMessageState,
    type StreamingUIMessageState,
  } from './processUIMessageStream';
import { parseUIMessageChunk, type ExtendedUIMessageChunk } from './parseUIMessageChunk';
import type { UIMessage } from "ai";

export class StreamUpstreamError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "StreamUpstreamError";
    }
  }

export function createState(messageId: string): StreamingUIMessageState<UIMessage> {
    return createStreamingUIMessageState({
        lastMessage: undefined,
        messageId,
    });
}

export function processChunk(args: {
    state: StreamingUIMessageState<UIMessage>;
    chunk: ExtendedUIMessageChunk;
}) {
    const { state, chunk } = args;
    
    processUIMessageStream__fast({
        state,
        chunk,
        write: () => {},
        onError: (err) => {
            throw new StreamUpstreamError((err as Error).message); // we make this error different class to distinguish from unexpected errors
        }
    })
}

export function parseChunk(data: string) : ExtendedUIMessageChunk {
    return parseUIMessageChunk(data);
}



// export function processEvent(args: {
//     state: StreamingUIMessageState<UIMessage>;
//     data: string;
// }) : string[] {
//     const { state, data } = args;

//     const chunk = parseUIMessageChunk(data);

//     processUIMessageStream__fast({
//         state,
//         chunk,
//         write: () => {},
//         onError: (err) => {
//             throw new StreamUpstreamError((err as Error).message); // we make this error different class to distinguish from unexpected errors
//         }
//     })

//     if (chunk.type === 'start') {
        
//     }

//     return [];
// }

