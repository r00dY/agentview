import { Resend } from 'resend';
import { defineEmailChannel } from '../defineEmailChannel';
import { log } from '../../logger';
import { createResendRoutes } from './routes';

const resend = new Resend(process.env.RESEND_API_KEY);

export const resendChannel = defineEmailChannel({
  type: 'resend',
  routes: (provider) => createResendRoutes(provider),
  sendEmail: () => async ({ channel, to, from, subject, textBody, inReplyTo, references }) => {
    const headers: Record<string, string> = {};
    if (inReplyTo) {
      headers['In-Reply-To'] = inReplyTo;
    }
    if (references && references.length > 0) {
      headers['References'] = references.join(' ');
    }

    log.info({ to, from, subject }, 'resend: sending email');

    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      text: textBody,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });

    if (error || !data) {
      log.error({ error, to, from }, 'resend: failed to send email');
      throw new Error(`Resend send failed: ${error?.message ?? 'unknown error'}`);
    }

    log.info({ resendId: data.id, to, from }, 'resend: email sent');

    // RESEND LIMITATION: This sourceId is NOT the real RFC Message-ID.
    //
    // Resend uses Amazon SES under the hood. SES assigns its own Message-ID
    // (e.g. <01020...@eu-west-1.amazonses.com>) and Resend's API never exposes it:
    //   - emails.send() returns only { id } (the Resend UUID)
    //   - emails.get() does not include message_id or headers
    //   - Custom Message-ID headers are silently overridden by SES
    //
    // This means when a recipient replies, their In-Reply-To will contain the
    // real SES Message-ID which does NOT match this sourceId. Thread resolution
    // for replies relies entirely on the References header chain, which carries
    // the original incoming email's Message-ID (that one IS real and stored
    // correctly). See resolveThreadId in defineEmailChannel.ts.
    //
    // This works for all modern email clients (Gmail, Outlook, Apple Mail,
    // Thunderbird) which always include References. A client that sends ONLY
    // In-Reply-To without References would break threading — but that's
    // non-standard and rare enough to accept as a known limitation.
    //
    // If Resend ever exposes message_id on their GET /emails/{id} endpoint,
    // we should fetch it after send (like the Gmail channel does) and use
    // the real value here.
    const sourceId = `<${data.id}@resend.dev>`;

    return {
      sourceId,
      providerData: {
        resendId: data.id,
      },
    };
  },
});
