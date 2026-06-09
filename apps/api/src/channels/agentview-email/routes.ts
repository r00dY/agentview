import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { Resend } from 'resend';
import { db__dangerous } from '../../db';
import { getEnvironmentByHandleAndOrgId } from '../../environments';
import { log } from '../../logger';
import { organizations } from '../../schemas/auth-schema';
import { buildReplyEmail } from '../buildReplyEmail';
import { parseAgentViewEmailAddress } from '../defineChannel';
import type { EmailChannelProvider, EmailMessageData } from '../defineEmailChannel';
import { formatChannelErrorBody } from '../formatChannelErrorBody';
import { getAgentViewEmailDomain } from '../getAgentViewEmailDomain';

const resend = new Resend(process.env.RESEND_API_KEY);

/** Extract bare email from "Name <email>" or just "email" */
function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

/**
 * Bootstrap an agentview-email channel on demand from its wildcarded address
 * ({orgSlug}.{envSlug}.{agentName}@{AGENTVIEW_EMAIL_DOMAIN}). Throws if the address
 * format is invalid, or the referenced org/environment doesn't exist.
 */
async function ensureAgentViewEmailChannel(provider: EmailChannelProvider, address: string) {
  const existing = await provider.getChannel(address);
  if (existing) return;

  const { orgSlug, envSlug } = parseAgentViewEmailAddress(address);

  const org = await db__dangerous.query.organizations.findFirst({
    where: eq(organizations.slug, orgSlug),
  });
  if (!org) {
    throw new Error(`Organization "${orgSlug}" not found.`);
  }

  const environment = await getEnvironmentByHandleAndOrgId(org.id, envSlug);
  if (!environment) {
    throw new Error(`Environment "${envSlug}" not found in organization "${orgSlug}".`);
  }

  await provider.createChannel(org.id, address, {}, environment.id);
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
    const headers = email.headers ?? {};

    // In-Reply-To and References come from email headers
    const inReplyTo = headers['in-reply-to'] || undefined;

    // RESEND BUG/QUIRK: Resend's receiving API returns the References header as a
    // stringified JSON array (e.g. '["<id1@x.com>","<id2@x.com>"]') instead of the
    // standard RFC 2822 space-separated format ("<id1@x.com> <id2@x.com>").
    // The SDK types say `headers: Record<string, string>` but the value for
    // "references" is actually a JSON-encoded array.
    //
    // This is critical for threading: resolveThreadId uses References to match
    // incoming replies against existing messages. If we naively split on whitespace
    // (like you'd do with RFC format), we get a single garbled string that never
    // matches any sourceId, and every reply creates a new thread.
    //
    // We parse as JSON first, fall back to RFC space-split for safety.
    const rawReferences = headers['references'];
    let references: string[] | undefined;
    if (rawReferences) {
      try {
        const parsed = JSON.parse(rawReferences);
        if (Array.isArray(parsed)) {
          references = parsed;
        }
      } catch {
        references = rawReferences.split(/\s+/).filter(Boolean);
      }
    }

    // Ingest for each recipient address (each may map to a different channel)

    // We take first address that has agentview email domain
    let address: string | undefined = undefined;

    for (const toAddress of toAddresses) {
      const emailAddress = extractEmailAddress(toAddress);
      if (emailAddress.split('@')[1] === getAgentViewEmailDomain()) {
        address = emailAddress;
        break;
      }
    }

    if (!address) {
      log.warn({ emailId }, 'resend webhook: no agentview email address found');
      return c.json({ status: 'ok' }, 200);
    }

    const agentViewEmail : EmailMessageData = {
      messageId: email.message_id,
      inReplyTo,
      references,
      subject: email.subject,
      from: email.headers.from,
      to: toAddresses.join(', '),
      cc: email.cc?.join(', '),
      htmlBody: email.html ?? undefined,
      textBody: email.text ?? undefined,
    };

    try {
      await ensureAgentViewEmailChannel(provider, address);

      await provider.ingestEmail(address, {
        date: email.created_at,
        email: agentViewEmail,
        providerData: {
          resendEmailId: emailId,
        },
      });
    } catch (error) {
      log.info({ err: error, address }, 'resend webhook: failed to ingest email');
      await sendIngestErrorReply(address, agentViewEmail, email.created_at, error);
    }

    return c.json({ status: 'ok' }, 200);
  });

  return app;
}

/**
 * Send an error reply back to the original sender when ingestion fails so
 * they aren't left wondering why nothing happened. Best-effort — swallows
 * its own failures so the webhook still returns 200.
 */
async function sendIngestErrorReply(
  fromAddress: string,
  incoming: EmailMessageData,
  date: string,
  error: unknown,
) {
  try {
    const reply = await buildReplyEmail({
      inReplyTo: incoming,
      inReplyToDate: date,
      fromAddress,
      text: formatChannelErrorBody(error),
    });

    const headers: Record<string, string> = { 'Message-ID': reply.messageId };
    if (reply.inReplyTo) headers['In-Reply-To'] = reply.inReplyTo;
    if (reply.references && reply.references.length > 0) {
      headers['References'] = reply.references.join(' ');
    }

    const { error: sendError } = await resend.emails.send({
      from: reply.from,
      to: reply.to,
      subject: reply.subject,
      text: reply.textBody ?? '',
      html: reply.htmlBody,
      headers,
    });

    if (sendError) {
      log.error({ err: sendError, fromAddress }, 'resend webhook: failed to send error reply');
    }
  } catch (replyErr) {
    log.error({ err: replyErr, fromAddress }, 'resend webhook: failed to build/send error reply');
  }
}
