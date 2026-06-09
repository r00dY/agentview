import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

export type GmailClient = {
  api: gmail_v1.Gmail;
  user: string;
};

export function createGmailClient(): GmailClient {
  const clientId = process.env.SMOKE_GMAIL_CLIENT_ID!;
  const clientSecret = process.env.SMOKE_GMAIL_CLIENT_SECRET!;
  const refreshToken = process.env.SMOKE_GMAIL_REFRESH_TOKEN!;
  const user = process.env.SMOKE_GMAIL_USER!;

  const oauth2: OAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  return {
    api: google.gmail({ version: 'v1', auth: oauth2 }),
    user,
  };
}

export type SentEmail = {
  /** Gmail's internal id for the sent message. */
  gmailId: string;
  /** Gmail thread id — pass this back to send replies in-thread. */
  threadId: string;
  /** RFC 2822 Message-ID header we constructed for this email. */
  messageId: string;
};

export type SendEmailParams = {
  to: string;
  subject: string;
  body: string;
  /** Continue an existing Gmail thread (turn 2+). */
  threadId?: string;
  /** RFC 2822 Message-ID of the email we're replying to. */
  inReplyTo?: string;
  /** Full References chain (oldest → newest). */
  references?: string[];
};

/**
 * Send a plain-text email from the test inbox via the Gmail API.
 *
 * The returned `messageId` is the ACTUAL `Message-ID` header that Gmail
 * stamped on the outgoing email (Gmail rewrites any Message-ID we set
 * locally). We need this real id for thread continuation — replies must
 * include it in `References` for the receiver's thread resolver to match.
 */
export async function sendEmail(gmail: GmailClient, params: SendEmailParams): Promise<SentEmail> {
  const headers: string[] = [
    `From: ${gmail.user}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
  ];
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references?.length) headers.push(`References: ${params.references.join(' ')}`);

  const raw = headers.join('\r\n') + '\r\n\r\n' + params.body;
  const encoded = Buffer.from(raw, 'utf-8').toString('base64url');

  const sendRes = await gmail.api.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encoded,
      threadId: params.threadId,
    },
  });

  // Gmail rewrote the Message-ID. Fetch it back from the canonical headers so
  // thread continuation in downstream systems lines up.
  const detail = await gmail.api.users.messages.get({
    userId: 'me',
    id: sendRes.data.id!,
    format: 'metadata',
    metadataHeaders: ['Message-ID'],
  });
  const realMessageId =
    detail.data.payload?.headers?.find((h) => h.name?.toLowerCase() === 'message-id')?.value ?? '';

  if (!realMessageId) {
    throw new Error('Gmail did not return a Message-ID for the sent message');
  }

  return {
    gmailId: sendRes.data.id!,
    threadId: sendRes.data.threadId!,
    messageId: realMessageId,
  };
}

export type ReceivedEmail = {
  gmailId: string;
  threadId: string;
  /** RFC 2822 Message-ID header value, e.g. "<abc@host>". */
  messageId: string;
  from: string;
  subject: string;
  body: string;
  internalDate: number;
};

export type WaitForEmailParams = {
  /** Match Gmail query e.g. "from:foo@bar in:inbox". */
  query: string;
  /** Stop matching messages older than this. Helps avoid stale matches across runs. */
  newerThan: Date;
  /** Match only messages that aren't this Gmail id (so a previous reply isn't matched twice). */
  excludeGmailId?: string;
  timeoutMs: number;
  pollIntervalMs?: number;
};

/**
 * Poll Gmail for the first message matching `query` that arrived after
 * `newerThan` and isn't `excludeGmailId`. Throws on timeout.
 */
export async function waitForEmail(gmail: GmailClient, params: WaitForEmailParams): Promise<ReceivedEmail> {
  const pollInterval = params.pollIntervalMs ?? 3000;
  const deadline = Date.now() + params.timeoutMs;
  // Gmail's `after:` filter takes a unix timestamp in seconds.
  const afterTs = Math.floor(params.newerThan.getTime() / 1000);
  const query = `${params.query} after:${afterTs}`;

  while (Date.now() < deadline) {
    const list = await gmail.api.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10,
    });

    const messages = list.data.messages ?? [];
    for (const m of messages) {
      if (m.id === params.excludeGmailId) continue;

      const detail = await gmail.api.users.messages.get({
        userId: 'me',
        id: m.id!,
        format: 'full',
      });

      const parsed = parseGmailMessage(detail.data);
      if (parsed.internalDate >= params.newerThan.getTime()) {
        return parsed;
      }
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error(
    `waitForEmail timed out after ${params.timeoutMs}ms (query: "${query}", excluded: ${params.excludeGmailId ?? '-'})`
  );
}

function parseGmailMessage(msg: gmail_v1.Schema$Message): ReceivedEmail {
  const headers = msg.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

  return {
    gmailId: msg.id!,
    threadId: msg.threadId!,
    messageId: header('Message-ID') || header('Message-Id'),
    from: header('From'),
    subject: header('Subject'),
    body: extractBody(msg.payload),
    internalDate: Number(msg.internalDate ?? 0),
  };
}

function extractBody(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return '';

  const collect = (part: gmail_v1.Schema$MessagePart, prefer: 'text/plain' | 'text/html'): string | null => {
    if (part.mimeType === prefer && part.body?.data) {
      return Buffer.from(part.body.data, 'base64url').toString('utf-8');
    }
    for (const sub of part.parts ?? []) {
      const found = collect(sub, prefer);
      if (found) return found;
    }
    return null;
  };

  return collect(payload, 'text/plain') ?? collect(payload, 'text/html') ?? '';
}
