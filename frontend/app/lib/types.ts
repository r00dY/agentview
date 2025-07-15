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


  
// export type AgentViewConfig = {
//     email: (payload: EmailPayload) => Promise<void>;

// }