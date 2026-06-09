export function getEmailRootDomain() {
  if (!process.env.AGENTVIEW_EMAIL_ROOT_DOMAIN) {
    throw new Error('AGENTVIEW_EMAIL_ROOT_DOMAIN is not set');
  }
  return process.env.AGENTVIEW_EMAIL_ROOT_DOMAIN;
}