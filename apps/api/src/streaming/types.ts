import type { IncomingMessage } from "node:http";
import { RunTerminationError } from "../runs";
import type { State } from "./processEvent";

// signal to shut down streaming gracefully (to distinguish from normal RunTerminationError)
export class GracefulRunTerminationError extends RunTerminationError {}


export interface LiveConnection {
  runId: string;

  upstreamRes: IncomingMessage;
  metadata: string;

  state: State

  // In-memory stream buffer for GET /stream consumers
  streamBuffer: string[];
  streamDone: boolean;
  streamListeners: Set<(data: string) => void>;
  streamDoneListeners: Set<() => void>;
}
