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
  resolveChannel,
} from './defineChannel';
import { marked } from 'marked';
import { withOrg } from 'src/withOrg';
import { emailToMarkdown } from './emailToMarkdown';

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

export type IngestEmailParams = {
  email: EmailMessageData;
  date: string;
  providerData?: any;
};

export type EmailSendParams = {
  channel: Channel;
  to: string;
  from: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  inReplyTo?: string;
  references?: string[];
  providerData?: any;
};

export type EmailSendResult = SendMessageResult;

export type EmailSendFn = (params: EmailSendParams) => Promise<EmailSendResult>;

export type EmailChannelProvider = ChannelProvider & {
  ingestEmail: (address: string, params: IngestEmailParams) => Promise<any>;
};

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

function buildSendMessageWrapper(
  _: ChannelProvider,
  emailSendFn: EmailSendFn,
): SendMessageFn {
  return async ({ channelThread, channel, message }) => {
    // Find the last incoming message in the same channel thread
    const lastMessage = await db__dangerous.query.channelMessages.findFirst({
      where: and(
        eq(channelMessages.channelThreadId, message.channelThreadId),
        eq(channelMessages.direction, 'incoming'),
      ),
      orderBy: (cm, { desc }) => [desc(cm.date)],
    });

    const lastEmailData = (lastMessage?.providerData as any)?.email as EmailMessageData | undefined;

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

    // Collect provider data from the last message
    // (e.g., Gmail threadId for keeping messages in the same Gmail thread)
    const threadProviderData = lastMessage?.providerData
      ? { ...lastMessage.providerData as any }
      : undefined;
    if (threadProviderData) {
      delete threadProviderData.email;
    }

    // Include quoted previous message with attribution line.
    // The attribution ("On <date>, <from> wrote:") is what email clients like
    // Gmail use to detect and collapse quoted text behind "..." in threaded view.
    let textBody = message.text ?? '';
    const quotedText = lastMessage?.text || lastEmailData?.textBody;
    // lastEmailData.from has the full "Name <email>" format when available,
    // fall back to bare author email from the last message
    const quotedFrom = lastEmailData?.from || lastMessage?.authorEmail;
    if (quotedText && quotedFrom) {
      const date = lastMessage?.date
        ? new Date(lastMessage.date).toUTCString()
        : undefined;
      const attribution = date
        ? `On ${date}, ${quotedFrom} wrote:`
        : `${quotedFrom} wrote:`;
      const quoted = quotedText.split('\n').map((line) => `> ${line}`).join('\n');
      textBody = `${textBody}\n\n${attribution}\n${quoted}`;
    }

    // Build HTML version: convert the reply markdown to HTML,
    // then append the quoted original as a standard blockquote.
    const replyHtml = await marked.parse(message.text ?? '');
    let htmlBody = replyHtml;
    const quotedHtml = lastEmailData?.htmlBody || lastEmailData?.textBody;
    if (quotedHtml && quotedFrom) {
      const date = lastMessage?.date
        ? new Date(lastMessage.date).toUTCString()
        : undefined;
      const attr = date
        ? `On ${date}, ${quotedFrom} wrote:`
        : `${quotedFrom} wrote:`;
      htmlBody += `<div class="gmail_quote"><p>${attr}</p><blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${quotedHtml}</blockquote></div>`;
    }

    // Derive recipient from the last incoming message's email headers or author
    const replyTo = lastEmailData?.from || lastMessage?.authorEmail || '';

    const result = await emailSendFn({
      channel,
      to: replyTo,
      from: channel.address,
      subject,
      textBody,
      htmlBody,
      inReplyTo,
      references,
      providerData: threadProviderData,
    });

    return {
      sourceId: result.sourceId,
      providerData: {
        email: {
          inReplyTo,
          references: references ? [...references] : undefined,
          subject,
          from: channel.address,
          to: replyTo,
        },
        ...(result.providerData ?? {}),
      },
    };
  };
}

export function defineEmailChannel(config: {
  type: string;
  routes?: (provider: EmailChannelProvider) => any;
  workers?: (provider: ChannelProvider) => any[];
  sendEmail: (provider: ChannelProvider) => EmailSendFn;
}): ChannelApp {
  const provider = channelProvider(config.type);

  const ingestEmail = async (address: string, params: IngestEmailParams) => {
    // Look up channel to get channelId for thread resolution

    console.log('################ INGEST EMAIL #################');

    try {
      if (!params.email.messageId) {
        throw new Error('[defineEmailChannel] Email has no Message-ID — this should never happen');
      }

      const channel = await resolveChannel(config.type, address);

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
      const sourceThreadId = await resolveThreadId(channel.organizationId, channel.id, params.email);

      const providerData = {
        email: {
          messageId: params.email.messageId,
          inReplyTo: params.email.inReplyTo,
          references: params.email.references,
          subject: params.email.subject,
          from: params.email.from,
          to: params.email.to,
          cc: params.email.cc,
          htmlBody: params.email.htmlBody,
          textBody: params.email.textBody,
        },
        ...(params.providerData ?? {}),
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
    }
    catch (error) {
      console.log('------ERROR INGEST EMAIL------');
      console.log(error);
      return { ingested: false, reason: (error as Error).message }
    }
  };

  const emailProvider: EmailChannelProvider = {
    ...provider,
    ingestEmail,
  };

  const emailSendFn = config.sendEmail(provider);
  const wrappedSendMessage = buildSendMessageWrapper(provider, emailSendFn);

  return {
    type: config.type,
    routes: config.routes ? config.routes(emailProvider) : null,
    workers: config.workers ? config.workers(provider) : [],
    sendMessage: wrappedSendMessage,
  };
}
