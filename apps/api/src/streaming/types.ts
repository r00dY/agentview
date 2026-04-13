import type { IncomingMessage } from "node:http";
import { RunTerminationError } from "../runs";
import type { State } from "./processEvent__old";
import type { StreamingUIMessageState } from "ai/process-ui-message-stream__modified";
import type { UIMessage } from "ai";

// signal to shut down streaming gracefully (to distinguish from normal RunTerminationError)
export class GracefulRunTerminationError extends RunTerminationError {}


export interface LiveConnection {
  runId: string;

  upstreamRes: IncomingMessage;
  metadata: string;

  state: StreamingUIMessageState<UIMessage>;

  // In-memory stream buffer for GET /stream consumers
  streamBuffer: string[];
  streamDone: boolean;
  streamListeners: Set<(data: string) => void>;
  streamDoneListeners: Set<() => void>;
}
