import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { authn, authorize, requireMemberPrincipal } from '../../authMiddleware';
import { response_data, response_error } from '../../hono_utils';
import type { EmailChannelProvider } from '../defineEmailChannel';
import {
  createOAuth2Client,
  createOAuthState,
  verifyOAuthState,
  exchangeCodeForTokens,
  GMAIL_SCOPES,
} from './client';
import { getWebAppUrl } from '../../getWebAppUrl';
import { getProfile, setupWatch, fetchNewEmails, createTokenRefreshHandler } from './api';
import type { GmailChannelConfig } from './types';

/** Extract bare email from "Name <email>" or just "email" */
function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

export function createGmailRoutes(gmail: EmailChannelProvider): OpenAPIHono {
  const app = new OpenAPIHono();

  // --- GET /auth ---

  const gmailAuthRoute = createRoute({
    method: 'get',
    path: '/auth',
    summary: 'Get Gmail OAuth URL',
    tags: ['Gmail'],
    responses: {
      200: response_data(z.object({ url: z.string() })),
      401: response_error(),
    },
  });

  app.openapi(gmailAuthRoute, async (c) => {
    const principal = await authn(c.req.raw.headers);
    authorize(principal, { action: 'environment:write' });
    const memberPrincipal = requireMemberPrincipal(principal);

    const state = createOAuthState(principal.organizationId, memberPrincipal.session.user.id);
    const client = createOAuth2Client();

    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GMAIL_SCOPES,
      state,
    });

    return c.json({ url }, 200);
  });

  // --- GET /callback ---

  app.get('/callback', async (c) => {
    const webAppUrl = getWebAppUrl();

    const error = c.req.query('error');
    const state = c.req.query('state');

    // Helper to build redirect URL
    const redirectToChannels = (orgId: string, params: Record<string, string>) => {
      const url = new URL(`${webAppUrl}/orgs/${orgId}/channels`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return c.redirect(url.toString());
    };

    if (error) {
      // State might still be present even on error
      let orgId = '';
      if (state) {
        try { orgId = verifyOAuthState(state).organizationId; } catch {}
      }
      if (orgId) {
        return redirectToChannels(orgId, { gmail: 'error', message: 'Gmail connection was denied' });
      }
      return c.redirect(`${webAppUrl}/dashboard`);
    }

    const code = c.req.query('code');

    if (!code || !state) {
      return c.redirect(`${webAppUrl}/dashboard`);
    }

    let statePayload: { organizationId: string; memberId: string };
    try {
      statePayload = verifyOAuthState(state);
    } catch {
      return c.redirect(`${webAppUrl}/dashboard`);
    }

    const { organizationId, memberId } = statePayload;

    try {
      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        return redirectToChannels(organizationId, { gmail: 'error', message: 'Failed to obtain tokens' });
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

      // Upsert: create if new, update if exists
      const existing = await gmail.getChannel(profile.emailAddress);
      if (existing) {
        await gmail.updateChannel(profile.emailAddress, config);
      } else {
        await gmail.createChannel(organizationId, profile.emailAddress, config);
      }

      return redirectToChannels(organizationId, { gmail: 'success' });
    } catch (err) {
      console.error('[gmail callback] Error:', err);
      return redirectToChannels(organizationId, { gmail: 'error', message: 'Something went wrong connecting Gmail' });
    }
  });

  // --- POST /webhook ---

  app.post('/webhook', async (c) => {
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
      const channel = await gmail.getChannel(emailAddress);

      if (!channel) {
        console.log(`[gmail webhook] No channel found for ${emailAddress}`);
        return c.json({ status: 'ok' }, 200);
      }

      const channelConfig = channel.config as GmailChannelConfig;

      if (!channelConfig.historyId) {
        console.log(`[gmail webhook] No historyId stored for ${emailAddress}`);
        return c.json({ status: 'ok' }, 200);
      }

      const onTokenRefresh = createTokenRefreshHandler(gmail, emailAddress);

      const result = await fetchNewEmails(
        channelConfig.accessToken,
        channelConfig.refreshToken,
        channelConfig.historyId,
        onTokenRefresh,
      );

      // Insert channel messages via threads
      for (const email of result.emails) {
        const fromEmail = extractEmailAddress(email.from);

        await gmail.ingestEmail(emailAddress, {
          contact: fromEmail,
          contactKind: 'email',
          date: email.date,
          text: email.textBody ?? undefined,
          email: {
            messageId: email.messageId,
            inReplyTo: email.inReplyTo,
            references: email.references,
            subject: email.subject,
            from: email.from,
            to: email.to,
            cc: email.cc,
            htmlBody: email.htmlBody ?? undefined,
          },
          providerData: {
            gmailId: email.id,
            gmailThreadId: email.threadId,
            snippet: email.snippet,
          },
        });
      }

      // Update historyId in channel config
      if (result.newHistoryId) {
        const current = await gmail.requireChannel(emailAddress);
        const currentConfig = current.config as GmailChannelConfig;
        await gmail.updateChannel(emailAddress, {
          ...currentConfig,
          historyId: result.newHistoryId,
        });
      } else {
        // historyId too old, re-setup watch
        console.log(`[gmail webhook] History expired for ${emailAddress}, re-setting up watch`);
        const watch = await setupWatch(
          channelConfig.accessToken,
          channelConfig.refreshToken,
          onTokenRefresh,
        );
        const current = await gmail.requireChannel(emailAddress);
        const currentConfig = current.config as GmailChannelConfig;
        await gmail.updateChannel(emailAddress, {
          ...currentConfig,
          historyId: watch.historyId,
          watchExpiresAt: watch.expiration,
        });
      }
    } catch (error) {
      console.error('[gmail webhook] Error processing webhook:', error);
    }

    return c.json({ status: 'ok' }, 200);
  });

  return app;
}
