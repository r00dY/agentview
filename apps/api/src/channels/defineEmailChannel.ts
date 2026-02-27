import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db__dangerous } from '../db';
import { channelMessages, channelThreads } from '../schemas/schema';
import {
  channelProvider,
  type Channel,
  type ChannelProvider,
  type ChannelApp,
  type SendMessageFn,
} from './defineChannel';

export type EmailMessageData = {
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
  from: string;
  to: string;
  cc?: string;
  htmlBody?: string;
};

export type IngestEmailParams = {
  email: EmailMessageData;
  date: string;
  contact: string;
  contactKind: 'email';
  text?: string;
  providerData?: any;
};

export type EmailSendParams = {
  channel: Channel;
  to: string;
  from: string;
  subject: string;
  textBody: string;
  inReplyTo?: string;
  references?: string[];
  providerData?: any;
};

export type EmailSendResult = {
  providerData?: any;
};

type EmailSendFn = (params: EmailSendParams) => Promise<EmailSendResult>;

export type EmailChannelProvider = ChannelProvider & {
  ingestEmail: (address: string, params: IngestEmailParams) => Promise<any>;
};

/**
 * Resolve thread by matching In-Reply-To / References headers against existing sourceIds.
 * Returns the sourceThreadId to use (existing thread's or the email's own messageId as anchor).
 */
async function resolveThreadId(
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
    // Find any existing message whose sourceId matches a candidate, scoped to this channel
    const existingMessage = await db__dangerous
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

    if (existingMessage.length > 0 && existingMessage[0].sourceThreadId) {
      return existingMessage[0].sourceThreadId;
    }
  }

  // No existing thread found — use this email's messageId as the thread anchor
  return email.messageId;
}

function buildSendMessageWrapper(
  provider: ChannelProvider,
  emailSendFn: EmailSendFn,
): SendMessageFn {
  return async ({ channelThread, channel, message }) => {
    // Find the first incoming message in this thread to get subject
    const firstIncoming = await db__dangerous.query.channelMessages.findFirst({
      where: and(
        eq(channelMessages.channelThreadId, channelThread.id),
        eq(channelMessages.direction, 'incoming'),
      ),
      orderBy: (cm, { asc }) => [asc(cm.date)],
    });

    const emailData = (firstIncoming?.providerData as any)?.email as EmailMessageData | undefined;
    const originalSubject = emailData?.subject ?? '';
    const subject = originalSubject
      ? (originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`)
      : 'No subject';

    // Find the last message (any direction) with a sourceId for In-Reply-To
    const lastMessage = await db__dangerous.query.channelMessages.findFirst({
      where: and(
        eq(channelMessages.channelThreadId, channelThread.id),
      ),
      orderBy: (cm, { desc }) => [desc(cm.date)],
    });

    const lastEmailData = (lastMessage?.providerData as any)?.email as EmailMessageData | undefined;
    const inReplyTo = lastMessage?.sourceId ?? undefined;

    // Build References chain: last message's references + last message's sourceId
    let references: string[] | undefined;
    if (lastEmailData?.references || lastMessage?.sourceId) {
      references = [...(lastEmailData?.references ?? [])];
      if (lastMessage?.sourceId && !references.includes(lastMessage.sourceId)) {
        references.push(lastMessage.sourceId);
      }
    }

    // Collect thread-level provider data from the first incoming message
    // (e.g., Gmail threadId for keeping messages in the same Gmail thread)
    const threadProviderData = firstIncoming?.providerData
      ? { ...firstIncoming.providerData as any }
      : undefined;
    // Remove the email namespace — sendEmail gets only provider-specific data
    if (threadProviderData) {
      delete threadProviderData.email;
    }

    const result = await emailSendFn({
      channel,
      to: channelThread.contact,
      from: channel.address,
      subject,
      textBody: message.text ?? '',
      inReplyTo,
      references,
      providerData: threadProviderData,
    });

    return {
      providerData: {
        email: {
          inReplyTo,
          references: references ? [...references] : undefined,
          subject,
          from: channel.address,
          to: channelThread.contact,
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
    const channel = await provider.getChannel(address);
    if (!channel) {
      console.log('[defineEmailChannel] Channel not found for address:', address);
      return { ingested: false, reason: 'Channel not found' };
    }

    // sanity check with messageId
    if (!params.email.messageId) {
      throw new Error('[defineEmailChannel] Email has no Message-ID — this should never happen');
    }


    // // Echo detection: check if this email is our own outgoing message bounced back.
    // // We match by text content + direction=outgoing + sourceId IS NULL (not yet matched).
    // // No race condition: the outgoing message row exists before the email is even sent.
    // if (params.text) {
    //   const echoMatch = await db__dangerous
    //     .select({ id: channelMessages.id })
    //     .from(channelMessages)
    //     .innerJoin(channelThreads, eq(channelMessages.channelThreadId, channelThreads.id))
    //     .where(
    //       and(
    //         eq(channelThreads.channelId, channel.id),
    //         eq(channelMessages.direction, 'outgoing'),
    //         eq(channelMessages.text, params.text),
    //         isNull(channelMessages.sourceId),
    //       ),
    //     )
    //     .orderBy(channelMessages.createdAt)
    //     .limit(1);

    //   if (echoMatch.length > 0) {
    //     await db__dangerous
    //       .update(channelMessages)
    //       .set({ sourceId: messageId, updatedAt: new Date().toISOString() })
    //       .where(eq(channelMessages.id, echoMatch[0].id));

    //     console.log('[defineEmailChannel] Detected echo of outgoing message, setting sourceId and skipping ingestion');
    //     return { ingested: false, reason: 'Echo of outgoing message' };
    //   }
    // }

    const sourceThreadId = await resolveThreadId(channel.id, params.email);

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
      },
      ...(params.providerData ?? {}),
    };

    return provider.ingestMessage(address, {
      sourceId: params.email.messageId,
      sourceThreadId,
      date: params.date,
      contact: params.contact,
      contactKind: params.contactKind,
      text: params.text,
      providerData,
    });
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
