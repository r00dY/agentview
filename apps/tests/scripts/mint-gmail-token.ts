/**
 * One-off helper: mints a Gmail OAuth refresh token for the smoke test inbox.
 *
 * Usage:
 *   1. In Google Cloud Console (https://console.cloud.google.com/apis/credentials):
 *      - Create or reuse an "OAuth 2.0 Client ID" of type "Web application".
 *      - Add this redirect URI: http://localhost:53682/oauth2callback
 *   2. Put the client id/secret in .env.local:
 *        SMOKE_GMAIL_CLIENT_ID=...
 *        SMOKE_GMAIL_CLIENT_SECRET=...
 *   3. Run: pnpm --filter ./apps/tests mint-gmail-token
 *   4. Open the printed URL, sign in with the TEST gmail account.
 *   5. Copy the printed SMOKE_GMAIL_REFRESH_TOKEN line into .env.local.
 *
 * Refresh tokens for OAuth apps in "Testing" mode expire after 7 days. When
 * that happens the smoke test fails with `invalid_grant`; re-run this script.
 */
import { google } from 'googleapis';
import http from 'node:http';
import { URL } from 'node:url';

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

async function main() {
  const clientId = process.env.SMOKE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.SMOKE_GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Missing env vars: SMOKE_GMAIL_CLIENT_ID and/or SMOKE_GMAIL_CLIENT_SECRET.');
    console.error('');
    console.error('Setup:');
    console.error('  1. https://console.cloud.google.com/apis/credentials');
    console.error('  2. Create/use an OAuth 2.0 Client ID of type "Web application".');
    console.error(`  3. Add Authorized redirect URI: ${REDIRECT_URI}`);
    console.error('  4. Put the credentials in .env.local:');
    console.error('       SMOKE_GMAIL_CLIENT_ID=...');
    console.error('       SMOKE_GMAIL_CLIENT_SECRET=...');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('1. Open this URL in your browser and sign in with the TEST gmail account:');
  console.log('');
  console.log('   ' + authUrl);
  console.log('');
  console.log(`2. Waiting for callback on ${REDIRECT_URI} ...`);

  const code = await waitForCode();
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    console.error('');
    console.error('No refresh_token in the response. This usually means the test gmail account');
    console.error('has previously authorized this OAuth client. To force a fresh refresh token:');
    console.error('  - Revoke access at https://myaccount.google.com/permissions');
    console.error('  - Re-run this script.');
    process.exit(1);
  }

  console.log('');
  console.log('SUCCESS. Add the following line to .env.local:');
  console.log('');
  console.log(`SMOKE_GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('');
  console.log('Make sure SMOKE_GMAIL_USER is also set to the test inbox address (e.g. foo@gmail.com).');
}

function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      const done = (status: number, body: string) => {
        res.writeHead(status, { 'Content-Type': 'text/html' }).end(body);
        server.close();
      };

      if (error) {
        done(400, `<h1>OAuth error</h1><pre>${error}</pre>`);
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      if (!code) {
        done(400, '<h1>Missing code</h1>');
        reject(new Error('No code in callback'));
        return;
      }

      done(200, '<h1>Done.</h1><p>You can close this tab and return to the terminal.</p>');
      resolve(code);
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1');
  });
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
