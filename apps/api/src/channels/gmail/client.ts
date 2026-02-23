import { google } from 'googleapis';
import jwt from 'jsonwebtoken';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_OAUTH_REDIRECT_URI,
  );
}

export function createOAuthState(organizationId: string, memberId: string): string {
  return jwt.sign(
    { organizationId, memberId },
    process.env.GMAIL_STATE_SECRET!,
    { expiresIn: '10m' },
  );
}

export function verifyOAuthState(state: string): { organizationId: string; memberId: string } {
  return jwt.verify(state, process.env.GMAIL_STATE_SECRET!) as {
    organizationId: string;
    memberId: string;
  };
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}
