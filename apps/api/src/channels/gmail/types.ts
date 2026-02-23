export type GmailChannelConfig = {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string | null;
  historyId: string | null;
  watchExpiresAt: string | null;
  connectedBy: string;
};
