import { google } from 'googleapis';
import { createOAuth2Client } from './client';

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
