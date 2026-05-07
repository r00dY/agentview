import { OpenAPIHono } from '@hono/zod-openapi';
import { Resend } from 'resend';
import { log } from '../../logger';
import type { EmailChannelProvider } from '../defineEmailChannel';

const resend = new Resend(process.env.RESEND_API_KEY);

/** Extract bare email from "Name <email>" or just "email" */
function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

export function createResendRoutes(provider: EmailChannelProvider): OpenAPIHono {
  const app = new OpenAPIHono();

  app.post('/webhook', async (c) => {
    const body = await c.req.json();

    if (body.type !== 'email.received') {
      log.info({ type: body.type }, 'resend webhook: ignoring non-received event');
      return c.json({ status: 'ok' }, 200);
    }

    const emailId: string | undefined = body.data?.email_id;
    if (!emailId) {
      log.warn('resend webhook: no email_id in payload');
      return c.json({ status: 'ok' }, 200);
    }

    // Webhook only has metadata — fetch full email content
    const { data: email, error } = await resend.emails.receiving.get(emailId);
    if (error || !email) {
      log.error({ emailId, error }, 'resend webhook: failed to fetch received email');
      return c.json({ error: 'Failed to fetch email' }, 500);
    }

    log.info({ emailId, from: email.from, to: email.to, subject: email.subject }, 'resend webhook: processing received email');

    const toAddresses = email.to ?? [];
    const fromEmail = extractEmailAddress(email.from);
    const headers = email.headers ?? {};

    // In-Reply-To and References come from email headers
    const inReplyTo = headers['in-reply-to'] || undefined;
    const rawReferences = headers['references'];
    const references = rawReferences
      ? rawReferences.split(/\s+/).filter(Boolean)
      : undefined;

    // Ingest for each recipient address (each may map to a different channel)
    for (const toAddress of toAddresses) {
      const address = extractEmailAddress(toAddress);

      await provider.ingestEmail(address, {
        contact: fromEmail,
        contactKind: 'email',
        date: email.created_at,
        text: email.text ?? undefined,
        email: {
          messageId: email.message_id,
          inReplyTo,
          references,
          subject: email.subject,
          from: email.from,
          to: toAddresses.join(', '),
          cc: email.cc?.join(', '),
          htmlBody: email.html ?? undefined,
          textBody: email.text ?? undefined,
        },
        providerData: {
          resendEmailId: emailId,
        },
      });
    }

    return c.json({ status: 'ok' }, 200);
  });

  return app;
}
