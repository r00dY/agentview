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

export interface NonAsyncRunResult {
  manifest: VersionManifest;
  activities: any[];
}
  
export type AgentViewConfig = {
  email: (payload: EmailPayload) => Promise<void>;
  threads: any,
  scores: any,
  run: (state: { thread: any }) => Promise<NonAsyncRunResult> | AsyncGenerator<VersionManifest | any, any, any>;
}