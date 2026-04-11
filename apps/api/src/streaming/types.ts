import { RunTerminationError } from "../runs";
import type { State } from "./processEvent";

// signal to shut down streaming gracefully (to distinguish from normal RunTerminationError)
export class GracefulRunTerminationError extends RunTerminationError {}


export interface LiveConnection {
  runId: string;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  abortController: AbortController;
  metadata: string;

  state: State

  // In-memory stream buffer for GET /stream consumers
  streamBuffer: string[];
  streamDone: boolean;
  streamNotify: (() => void)[];
}
