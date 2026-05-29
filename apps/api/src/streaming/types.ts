import type { ClientRequest, IncomingMessage } from "node:http";
import { RunTerminationError } from "../runs";
import type { StreamingUIMessageState } from "./processUIMessageStream";
import type { UIMessage } from "ai";

// signal to shut down streaming gracefully (to distinguish from normal RunTerminationError)
export class GracefulRunTerminationError extends RunTerminationError {}


export type LiveConnectionConnecting = {
  phase: 'connecting';
  upstreamReq: ClientRequest;
};

export interface LiveConnectionStreaming {
  phase: 'streaming';

  run: {
    id: string;
    agentRef: {
      agent: string;
      version: string;
      adapter: string;
    };
    status: string;
    reason: any | null;
    createdAt: string;
    finishedAt: string | null;
    metadata: Record<string, any> | null;
  };

  upstreamReq: ClientRequest;
  upstreamRes: IncomingMessage;
  metadata: string;

  state: StreamingUIMessageState<UIMessage>;

  // Timestamp (ms) of the last keep-alive ping sent to the HTTP server.
  // Updated when upstream sends data; used to throttle pings to once per 5s.
  lastActivityAt: number;

  // In-memory stream buffer for GET /stream consumers
  streamBuffer: string[];
  streamDone: boolean;
  streamListeners: Set<(data: string) => void>;
  streamDoneListeners: Set<() => void>;
}

export type LiveConnection = LiveConnectionConnecting | LiveConnectionStreaming;
