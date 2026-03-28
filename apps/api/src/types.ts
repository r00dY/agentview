import type { db__dangerous } from "./db";

export interface EmailPayload {
  to: string | string[];
  subject: string;
  text?: string;        // Plain text version (optional but recommended)
  html?: string;        // HTML version (optional but recommended if you want rich content)
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string; // Can be a buffer, string, or stream depending on implementation
    contentType?: string;
  }>;
}

export interface VersionManifest {
  type: "manifest";
  version: string;
  env?: "prod" | "dev" | `dev.${string}`;
  metadata?: any;
}

export type Transaction = Parameters<Parameters<typeof db__dangerous["transaction"]>[0]>[0]

// cancelled - user cancelled
// failed - error in the run while streaming. Partial data potentially available. Can be retried, error should be displayed in UI. This run should be 
// discarded - run was discarded by the AgentView. For example new channel message dropped while run was in progress, or agent endpoint returned 4xx or errored out on network. Those errors should not be visible for user, user should get immediate feedback from API.
// export type RunTerminationBody = { status: 'cancelled' } | { status: 'failed', failReason: any } | { status: 'discarded', failReason: any };

// export class RunTerminationError extends Error {
//   body: RunTerminationBody;

//   constructor(message: string, body: RunTerminationBody) {
//     super(message);
//     this.name = 'RunTerminationError';
//     this.body = body;
//   }
// }