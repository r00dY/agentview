import type { IncomingMessage } from "node:http";
import { RunTerminationError } from "../runs";
import type { StreamingUIMessageState } from "./processUIMessageStream";
import type { UIMessage } from "ai";

// signal to shut down streaming gracefully (to distinguish from normal RunTerminationError)
export class GracefulRunTerminationError extends RunTerminationError {}


export interface LiveConnection {
  run: {
    id: string;
    agentRef: {
      agent: string;
      version: string;
      adapter: string;
    };
    status: string;
    failReason: any | null;
    createdAt: string;
    finishedAt: string | null;
    metadata: Record<string, any> | null;
  };

  upstreamRes: IncomingMessage;
  metadata: string;

  state: StreamingUIMessageState<UIMessage>;

  // In-memory stream buffer for GET /stream consumers
  streamBuffer: string[];
  streamDone: boolean;
  streamListeners: Set<(data: string) => void>;
  streamDoneListeners: Set<() => void>;
}
