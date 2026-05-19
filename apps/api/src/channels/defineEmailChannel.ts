import { and, eq, inArray } from 'drizzle-orm';
import { db__dangerous } from '../db';
import { log } from '../logger';
import { channelMessages, channelThreads } from '../schemas/schema';
import {
  channelProvider,
  type Channel,
  type ChannelProvider,
  type ChannelApp,
  type SendMessageFn,
  type SendMessageResult,
} from './defineChannel';
import { marked } from 'marked';
import { withOrg } from 'src/withOrg';
import { emailToMarkdown } from './emailToMarkdown';
import { formatChannelErrorBody } from './formatChannelErrorBody';

const presence = (s?: string) => s?.trim() || undefined;

function extractEmailInfo(from: string): { email: string; name?: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].replace(/^["']|["']$/g, '').trim();
    return { email: match[2].trim().toLowerCase(), name: name || undefined };
  }
  return { email: from.trim().toLowerCase() };
}

export type EmailMessageData = {
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
  from: string;
  to: string;
  cc?: string;
  textBody?: string;
  htmlBody?: string;
};

/**
 * sourceId -> removed, it's always Message-ID
 * sourceThreadId -> optional. If not set, we resolve it based on heuristics. If set, we use it for threading (for example in Gmail)
 * email -> just standardised email body. We infer from it `text`, `title` and `author`
 */
export type IngestEmailParams = {
  sourceThreadId?: string; // can be external, for example in gmail. If set, we don't need to resolve it.

  date: string;

  email: EmailMessageData;
  providerData?: any;
};

export type EmailSendResult = SendMessageResult;
export type EmailSendParams = { address: string; email: EmailMessageData; sourceThreadId: string };

export type EmailSendFn = (params: EmailSendParams) => Promise<EmailSendResult>;

export type EmailChannelProvider = ChannelProvider & {
  ingestEmail: (address: string, params: IngestEmailParams) => Promise<any>;
};

export function defineEmailChannelApp(
  type: string, 
  creator: (provider: EmailChannelProvider) => {
    sendEmail: EmailSendFn;
    routes?: any;
    workers?: any[];
  }
): ChannelApp {
  const provider = channelProvider(type);
  
  const ingestEmail = async (address: string, params: IngestEmailParams) => {
    if (!params.email.messageId) {
      throw new Error('[defineEmailChannelApp] Email has no Message-ID — this should never happen');
    }

    const channel = await provider.requireChannel(address);

    /**
     * We should only resolveThreadId for NEW emails. If the email is already in our inbox (we sent it ourselves), then it already has a threadId.
     * We could pass it to ingestMessage, but it's not really necessary. We can just dedupe here (even though ingestMessage has deduping logic too!).
     */
    const duplicate = await withOrg(channel.organizationId, async (tx) => {
      return tx
        .select({ id: channelMessages.id })
        .from(channelMessages)
        .innerJoin(channelThreads, eq(channelMessages.channelThreadId, channelThreads.id))
        .where(
          and(
            eq(channelThreads.channelId, channel.id),
            eq(channelMessages.sourceId, params.email.messageId),
          ),
        )
        .limit(1);
    });

    if (duplicate.length > 0) {
      log.info({ messageId: params.email.messageId }, 'duplicate email, skipping');
      return { ingested: false, reason: 'Duplicate message' };
    }

    /**
     * Heuristic for finding the thread id based on the email's headers.
     */
    const sourceThreadId = params.sourceThreadId ?? await resolveThreadId(channel.organizationId, channel.id, params.email);

    const providerData = {
      ...(params.providerData ?? {}),
      email: params.email, // email must be stored in providerData
    };

    const parsed = await emailToMarkdown({
      html: params.email.htmlBody,
      text: params.email.textBody,
    });

    const fromInfo = extractEmailInfo(params.email.from);

    return provider.ingestMessage(address, {
      sourceId: params.email.messageId,
      sourceThreadId,
      date: params.date,
      text: parsed.content,
      providerData,
      title: params.email.subject || undefined,
      author: {
        email: fromInfo.email,
        name: fromInfo.name ?? presence(parsed.user?.name),
        headline: presence(parsed.user?.headline),
        details: presence(parsed.user?.details),
      },
    });
  };

  const emailProvider: EmailChannelProvider = {
    ...provider,
    ingestEmail,
  };

  const emailApp = creator(emailProvider);

  return {
    type,
    routes: emailApp.routes ?? null,
    workers: emailApp.workers ?? [],
    sendMessage: buildSendMessage(provider, emailApp.sendEmail),
  };
}



/**
 * Resolve thread by matching In-Reply-To / References headers against existing sourceIds.
 * Returns the sourceThreadId to use (existing thread's or the email's own messageId as anchor).
 */
async function resolveThreadId(
  organizationId: string,
  channelId: string,
  email: EmailMessageData,
): Promise<string> {
  const candidates: string[] = [];

  if (email.inReplyTo) {
    candidates.push(email.inReplyTo);
  }
  if (email.references) {
    for (const ref of email.references) {
      if (!candidates.includes(ref)) {
        candidates.push(ref);
      }
    }
  }

  if (candidates.length > 0) {
    const existingMessage = await withOrg(organizationId, async (tx) => {
      return tx
        .select({
          sourceThreadId: channelThreads.sourceThreadId,
        })
        .from(channelMessages)
        .innerJoin(channelThreads, eq(channelMessages.channelThreadId, channelThreads.id))
        .where(
          and(
            eq(channelThreads.channelId, channelId),
            inArray(channelMessages.sourceId, candidates),
          ),
        )
        .limit(1);
    });

    if (existingMessage.length > 0 && existingMessage[0].sourceThreadId) {
      return existingMessage[0].sourceThreadId;
    }
  }

  // No existing thread found — use this email's messageId as the thread anchor
  return email.messageId;
}

function buildSendMessage(
  provider: ChannelProvider,
  emailSendFn: EmailSendFn,
): SendMessageFn {
  return async ({ address, text, sourceThreadId }) => {
    const channel = await provider.requireChannel(address);

    if (!sourceThreadId) {
      throw new Error(`[INTERNAL ERROR] no sourceThreadId provided for ${channel.type} ${channel.address}`);
    }

    // Look up the last incoming message in this thread to build a proper Re: chain.
    // No sourceThreadId (or no matching thread) means we can't derive a recipient.

    const thread = await db__dangerous.query.channelThreads.findFirst({
      where: and(
        eq(channelThreads.channelId, channel.id),
        eq(channelThreads.sourceThreadId, sourceThreadId),
      ),
    });

    if (!thread) {
      throw new Error(`[INTERNAL ERROR] no thread found for sourceThreadId=${sourceThreadId} on ${channel.type} ${channel.address}`);
    }

    const lastMessage = await db__dangerous.query.channelMessages.findFirst({
      where: and(
        eq(channelMessages.channelThreadId, thread.id),
        eq(channelMessages.direction, 'incoming'),
      ),
      orderBy: (cm, { desc }) => [desc(cm.date)],
    });

    if (!lastMessage) {
      throw new Error(`[INTERNAL ERROR] no last message found for sourceThreadId=${sourceThreadId} on ${channel.type} ${channel.address}`);
    }

    const lastEmailData = (lastMessage?.providerData as any)?.email as EmailMessageData | undefined;

    // lastEmailData.from has the full "Name <email>" format when available,
    // fall back to bare author email from the last message
    const replyTo = lastEmailData?.from || lastMessage?.authorEmail || '';
    if (!replyTo) {
      throw new Error(`Cannot send email on channel ${channel.type} ${channel.address}: no recipient (no incoming message found for sourceThreadId=${sourceThreadId ?? '(none)'})`);
    }

    const originalSubject = lastEmailData?.subject ?? '';
    const subject = originalSubject
      ? (originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`)
      : 'No subject';

    const inReplyTo = lastMessage?.sourceId ?? undefined;

    // Build References chain: last message's references + last message's sourceId
    let references: string[] | undefined;
    if (lastEmailData?.references || lastMessage?.sourceId) {
      references = [...(lastEmailData?.references ?? [])];
      if (lastMessage?.sourceId && !references.includes(lastMessage.sourceId)) {
        references.push(lastMessage.sourceId);
      }
    }

    // Include quoted previous message with attribution line.
    // The attribution ("On <date>, <from> wrote:") is what email clients like
    // Gmail use to detect and collapse quoted text behind "..." in threaded view.
    let textBody = text;
    const quotedText = lastMessage?.text || lastEmailData?.textBody;
    if (quotedText) {
      const date = lastMessage?.date
        ? new Date(lastMessage.date).toUTCString()
        : undefined;
      const attribution = date
        ? `On ${date}, ${replyTo} wrote:`
        : `${replyTo} wrote:`;
      const quoted = quotedText.split('\n').map((line) => `> ${line}`).join('\n');
      textBody = `${textBody}\n\n${attribution}\n${quoted}`;
    }

    // Build HTML version: convert the reply markdown to HTML,
    // then append the quoted original as a standard blockquote.
    const replyHtml = await marked.parse(text);
    let htmlBody = replyHtml;
    const quotedHtml = lastEmailData?.htmlBody || lastEmailData?.textBody;
    if (quotedHtml) {
      const date = lastMessage?.date
        ? new Date(lastMessage.date).toUTCString()
        : undefined;
      const attr = date
        ? `On ${date}, ${replyTo} wrote:`
        : `${replyTo} wrote:`;
      htmlBody += `<div class="gmail_quote"><p>${attr}</p><blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${quotedHtml}</blockquote></div>`;
    }

    const newEmail: EmailMessageData = {
      messageId: `${crypto.randomUUID()}@${channel.address}`,
      to: replyTo,
      from: channel.address,

      subject,
      textBody,
      htmlBody,

      inReplyTo,
      references,
    };

    const result = await emailSendFn({
      address,
      email: newEmail,
      sourceThreadId
    });

    return {
      sourceId: result.sourceId,
      providerData: {
        email: newEmail,
        ...(result.providerData ?? {}),
      },
    };
  };
}



