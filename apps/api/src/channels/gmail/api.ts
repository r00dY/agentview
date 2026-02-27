import { google } from 'googleapis';
import { createOAuth2Client } from './client';
import type { GmailChannelConfig } from './types';

export type ParsedEmail = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  snippet: string;
  textBody: string | null;
  htmlBody: string | null;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
};

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractBody(payload: any): { textBody: string | null; htmlBody: string | null } {
  let textBody: string | null = null;
  let htmlBody: string | null = null;

  function walk(part: any) {
    if (!part) return;

    if (part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (part.mimeType === 'text/plain' && !textBody) {
        textBody = decoded;
      } else if (part.mimeType === 'text/html' && !htmlBody) {
        htmlBody = decoded;
      }
    }

    if (part.parts) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  }

  walk(payload);
  return { textBody, htmlBody };
}

type OnTokenRefresh = (tokens: { access_token: string; expiry_date: number | null }) => Promise<void>;

function createAuthenticatedClient(
  accessToken: string,
  refreshToken: string,
  onTokenRefresh?: OnTokenRefresh,
) {
  const client = createOAuth2Client();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (onTokenRefresh) {
    client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await onTokenRefresh({
          access_token: tokens.access_token,
          expiry_date: tokens.expiry_date ?? null,
        });
      }
    });
  }

  return google.gmail({ version: 'v1', auth: client });
}

export function createTokenRefreshHandler(
  provider: { requireChannel: (address: string) => Promise<{ config: unknown }>; updateChannel: (address: string, config: any) => Promise<any> },
  address: string,
): OnTokenRefresh {
  return async (tokens) => {
    const current = await provider.requireChannel(address);
    const currentConfig = current.config as GmailChannelConfig;
    await provider.updateChannel(address, {
      ...currentConfig,
      accessToken: tokens.access_token,
      tokenExpiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
    });
  };
}

export async function getProfile(accessToken: string, refreshToken: string) {
  const gmail = createAuthenticatedClient(accessToken, refreshToken);
  const res = await gmail.users.getProfile({ userId: 'me' });
  return { emailAddress: res.data.emailAddress!, historyId: res.data.historyId! };
}

export async function setupWatch(
  accessToken: string,
  refreshToken: string,
  onTokenRefresh?: OnTokenRefresh,
) {
  const gmail = createAuthenticatedClient(accessToken, refreshToken, onTokenRefresh);
  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: process.env.GOOGLE_PUBSUB_TOPIC!,
      labelIds: ['INBOX'],
    },
  });
  return {
    historyId: res.data.historyId!.toString(),
    expiration: new Date(Number(res.data.expiration!)).toISOString(),
  };
}

function encodeBase64Url(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sendEmail(
  accessToken: string,
  refreshToken: string,
  params: {
    from: string;
    to: string;
    subject: string;
    textBody: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string[];
  },
  onTokenRefresh?: OnTokenRefresh,
): Promise<{ gmailId: string; threadId: string; messageId: string }> {
  const gmail = createAuthenticatedClient(accessToken, refreshToken, onTokenRefresh);

  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
  ];

  if (params.inReplyTo) {
    lines.push(`In-Reply-To: ${params.inReplyTo}`);
  }
  if (params.references && params.references.length > 0) {
    lines.push(`References: ${params.references.join(' ')}`);
  }

  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push('');
  lines.push(params.textBody);

  const raw = encodeBase64Url(lines.join('\r\n'));

  console.log('')
  console.log('[gmail] sending email');
  console.log(lines.join('\r\n'));
  console.log('')

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      threadId: params.threadId ?? undefined,
    },
  });

  if (!res.data.id) {
    throw new Error('Gmail send returned no message ID');
  }

  console.log('[gmail] email sent successfully')

  // Fetch the sent message to get the RFC 2822 Message-ID header
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: res.data.id,
    format: 'metadata',
    metadataHeaders: ['Message-ID'],
  });

  const messageId = msg.data.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === 'message-id',
  )?.value ?? '';

  return {
    gmailId: res.data.id,
    threadId: res.data.threadId ?? '',
    messageId,
  };
}

export async function fetchNewEmails(
  accessToken: string,
  refreshToken: string,
  startHistoryId: string,
  onTokenRefresh?: OnTokenRefresh,
) {
  const gmail = createAuthenticatedClient(accessToken, refreshToken, onTokenRefresh);

  try {
    const historyRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
    });

    const histories = historyRes.data.history ?? [];
    const messageIds = new Set<string>();

    for (const h of histories) {
      for (const added of h.messagesAdded ?? []) {
        if (added.message?.id) {
          messageIds.add(added.message.id);
        }
      }
    }

    const emails: ParsedEmail[] = [];

    for (const msgId of messageIds) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'full',
      });

      const headers = msg.data.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      const { textBody, htmlBody } = extractBody(msg.data.payload);

      const rawMessageId = getHeader('Message-ID') || getHeader('Message-Id');
      const messageId = rawMessageId || `<generated-${msgId}@mail.gmail.com>`;

      const inReplyTo = getHeader('In-Reply-To') || undefined;

      const rawReferences = getHeader('References');
      const references = rawReferences
        ? rawReferences.split(/\s+/).filter(Boolean)
        : undefined;

      emails.push({
        id: msgId,
        threadId: msg.data.threadId ?? '',
        from: getHeader('From'),
        to: getHeader('To'),
        cc: getHeader('Cc'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        snippet: msg.data.snippet ?? '',
        textBody,
        htmlBody,
        messageId,
        inReplyTo,
        references,
      });
    }

    return {
      emails,
      newHistoryId: historyRes.data.historyId?.toString() ?? startHistoryId,
    };
  } catch (error: any) {
    // History ID too old - caller should re-setup watch
    if (error?.code === 404) {
      return { emails: [], newHistoryId: null };
    }
    throw error;
  }
}
