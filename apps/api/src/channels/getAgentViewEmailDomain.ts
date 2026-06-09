export function getAgentViewEmailDomain() {
  if (!process.env.AGENTVIEW_EMAIL_DOMAIN) {
    throw new Error('AGENTVIEW_EMAIL_DOMAIN is not set');
  }
  return process.env.AGENTVIEW_EMAIL_DOMAIN;
}