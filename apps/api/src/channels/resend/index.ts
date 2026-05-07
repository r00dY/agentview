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

    // Resend's send API doesn't return the RFC Message-ID header.
    // Use a deterministic Message-ID derived from the Resend email ID.
    const messageId = `<${data.id}@resend.dev>`;

    return {
      sourceId: messageId,
      providerData: {
        resendId: data.id,
      },
    };
  },
});
