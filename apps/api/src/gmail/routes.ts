import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { authn, authorize, requireMemberId } from '../authMiddleware';
import { withOrg } from '../withOrg';
import { db__dangerous } from '../db';
import { channels, channelThreads, channelMessages } from '../schemas/schema';
import { response_data, response_error } from '../hono_utils';
import {
  createOAuth2Client,
  createOAuthState,
  verifyOAuthState,
  exchangeCodeForTokens,
  GMAIL_SCOPES,
} from './client';
import { getProfile, setupWatch, fetchNewEmails } from './api';
import type { GmailChannelConfig } from './types';

/** Extract bare email from "Name <email>" or just "email" */
function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

export const gmailApp = new OpenAPIHono();

// --- GET /api/gmail/auth ---

const gmailAuthRoute = createRoute({
  method: 'get',
  path: '/api/gmail/auth',
  summary: 'Get Gmail OAuth URL',
  tags: ['Gmail'],
  responses: {
    200: response_data(z.object({ url: z.string() })),
    401: response_error(),
  },
});

gmailApp.openapi(gmailAuthRoute, async (c) => {
  const principal = await authn(c.req.raw.headers);
  authorize(principal, { action: 'environment:write' });
  const memberId = requireMemberId(principal);

  const state = createOAuthState(principal.organizationId, memberId);
  const client = createOAuth2Client();

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state,
  });

  return c.json({ url }, 200);
});

// --- GET /api/gmail/callback ---

gmailApp.get('/api/gmail/callback', async (c) => {
  const error = c.req.query('error');
  if (error) {
    return c.html('<html><body><h2>Gmail connection was denied.</h2><p>You can close this window.</p></body></html>');
  }

  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.html('<html><body><h2>Missing parameters.</h2></body></html>', 400);
  }

  let statePayload: { organizationId: string; memberId: string };
  try {
    statePayload = verifyOAuthState(state);
  } catch {
    return c.html('<html><body><h2>Invalid or expired state. Please try again.</h2></body></html>', 400);
  }

  const { organizationId, memberId } = statePayload;

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    return c.html('<html><body><h2>Failed to obtain tokens. Please try again.</h2></body></html>', 400);
  }

  // Get email address
  const profile = await getProfile(tokens.access_token, tokens.refresh_token);

  // Setup push notifications
  const watch = await setupWatch(tokens.access_token, tokens.refresh_token);

  const config: GmailChannelConfig = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : null,
    historyId: watch.historyId,
    watchExpiresAt: watch.expiration,
    connectedBy: memberId,
  };

  // Upsert channel (one per email per org)
  await withOrg(organizationId, async (tx) => {
    await tx
      .insert(channels)
      .values({
        organizationId,
        type: 'gmail',
        name: profile.emailAddress,
        address: profile.emailAddress,
        status: 'active',
        config,
      })
      .onConflictDoUpdate({
        target: [channels.organizationId, channels.type, channels.address],
        set: {
          config,
          name: profile.emailAddress,
          status: 'active',
          updatedAt: new Date().toISOString(),
        },
      });
  });

  return c.html(
    '<html><body><h2>Gmail Connected!</h2><p>You can close this window.</p></body></html>',
  );
});

// --- POST /api/gmail/webhook ---

gmailApp.post('/api/gmail/webhook', async (c) => {
  // Always return 200 to avoid Pub/Sub redelivery loops
  try {
    const body = await c.req.json();

    // Decode Pub/Sub message
    const messageData = body?.message?.data;
    if (!messageData) {
      return c.json({ status: 'ok' }, 200);
    }

    const decoded = JSON.parse(Buffer.from(messageData, 'base64').toString('utf-8'));
    const { emailAddress, historyId } = decoded;

    if (!emailAddress) {
      return c.json({ status: 'ok' }, 200);
    }

    // Look up channel by address (cross-org)
    const channel = await db__dangerous.query.channels.findFirst({
      where: and(eq(channels.type, 'gmail'), eq(channels.address, emailAddress)),
    });

    if (!channel) {
      console.log(`[gmail webhook] No channel found for ${emailAddress}`);
      return c.json({ status: 'ok' }, 200);
    }

    const channelConfig = channel.config as GmailChannelConfig;

    if (!channelConfig.historyId) {
      console.log(`[gmail webhook] No historyId stored for ${emailAddress}`);
      return c.json({ status: 'ok' }, 200);
    }

    // Token refresh callback: read-then-write config pattern
    const onTokenRefresh = async (tokens: { access_token: string; expiry_date: number | null }) => {
      await withOrg(channel.organizationId, async (tx) => {
        const current = await tx.query.channels.findFirst({ where: eq(channels.id, channel.id) });
        if (!current) return;
        const currentConfig = current.config as GmailChannelConfig;
        await tx.update(channels).set({
          config: {
            ...currentConfig,
            accessToken: tokens.access_token,
            tokenExpiresAt: tokens.expiry_date
              ? new Date(tokens.expiry_date).toISOString()
              : null,
          },
          updatedAt: new Date().toISOString(),
        }).where(eq(channels.id, channel.id));
      });
    };

    const result = await fetchNewEmails(
      channelConfig.accessToken,
      channelConfig.refreshToken,
      channelConfig.historyId,
      onTokenRefresh,
    );

    // Insert channel messages via threads
    for (const email of result.emails) {
      // Extract bare email address from "Name <email>" format
      const fromEmail = extractEmailAddress(email.from);

      await withOrg(channel.organizationId, async (tx) => {
        // Find or create channel thread
        let thread = await tx.query.channelThreads.findFirst({
          where: and(
            eq(channelThreads.channelId, channel.id),
            eq(channelThreads.sourceThreadId, email.threadId),
            eq(channelThreads.contact, fromEmail),
            eq(channelThreads.contactKind, 'email'),
          ),
        });

        if (!thread) {
          const [newThread] = await tx
            .insert(channelThreads)
            .values({
              organizationId: channel.organizationId,
              channelId: channel.id,
              sourceThreadId: email.threadId,
              contact: fromEmail,
              contactKind: 'email',
              status: 'dirty',
            })
            .returning();
          thread = newThread;
        } else if (thread.status !== 'processing') {
          await tx
            .update(channelThreads)
            .set({ status: 'dirty', updatedAt: new Date().toISOString() })
            .where(eq(channelThreads.id, thread.id));
        }

        await tx.insert(channelMessages).values({
          organizationId: channel.organizationId,
          channelThreadId: thread.id,
          direction: 'incoming',
          sourceId: email.id,
          text: email.textBody,
          providerData: {
            subject: email.subject,
            htmlBody: email.htmlBody,
            cc: email.cc,
            date: email.date,
            snippet: email.snippet,
          },
          status: 'received',
        }).onConflictDoNothing({
          target: [channelMessages.channelThreadId, channelMessages.sourceId],
        });
      });
    }

    // Update historyId in channel config
    if (result.newHistoryId) {
      await withOrg(channel.organizationId, async (tx) => {
        const current = await tx.query.channels.findFirst({ where: eq(channels.id, channel.id) });
        if (!current) return;
        const currentConfig = current.config as GmailChannelConfig;
        await tx.update(channels).set({
          config: { ...currentConfig, historyId: result.newHistoryId },
          updatedAt: new Date().toISOString(),
        }).where(eq(channels.id, channel.id));
      });
    } else {
      // historyId too old, re-setup watch
      console.log(`[gmail webhook] History expired for ${emailAddress}, re-setting up watch`);
      const watch = await setupWatch(
        channelConfig.accessToken,
        channelConfig.refreshToken,
        onTokenRefresh,
      );
      await withOrg(channel.organizationId, async (tx) => {
        const current = await tx.query.channels.findFirst({ where: eq(channels.id, channel.id) });
        if (!current) return;
        const currentConfig = current.config as GmailChannelConfig;
        await tx.update(channels).set({
          config: {
            ...currentConfig,
            historyId: watch.historyId,
            watchExpiresAt: watch.expiration,
          },
          updatedAt: new Date().toISOString(),
        }).where(eq(channels.id, channel.id));
      });
    }
  } catch (error) {
    console.error('[gmail webhook] Error processing webhook:', error);
  }

  return c.json({ status: 'ok' }, 200);
});
