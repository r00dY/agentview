export const PRODUCTION_API_URL = 'https://api.agentview.app';
export const PRODUCTION_WEBAPP_URL = 'https://agentview.app';
export const PRODUCTION_EMAIL_DOMAIN = 'agent.agentview.app';

/**
 * Get API URL - works in Vite, Next.js, and Node.js environments.
 * Next.js requires literal `process.env.NEXT_PUBLIC_*` strings (build-time replacement),
 * so we cannot use dynamic key lookup.
 */
export function getApiUrl(): string {
  // @ts-ignore - import.meta.env only exists in Vite environments
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AGENTVIEW_API_URL) {
    // @ts-ignore
    return import.meta.env.VITE_AGENTVIEW_API_URL;
  }
  if (typeof process !== 'undefined') {
    const url = process.env.NEXT_PUBLIC_AGENTVIEW_API_URL
      ?? process.env.VITE_AGENTVIEW_API_URL
      ?? process.env.AGENTVIEW_API_URL;
    if (url) return url;
  }
  return PRODUCTION_API_URL;
}

/**
 * Get WebApp URL - works in Vite, Next.js, and Node.js environments.
 */
export function getWebAppUrl(): string {
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AGENTVIEW_WEBAPP_URL) {
    // @ts-ignore
    return import.meta.env.VITE_AGENTVIEW_WEBAPP_URL;
  }
  if (typeof process !== 'undefined') {
    const url = process.env.NEXT_PUBLIC_AGENTVIEW_WEBAPP_URL
      ?? process.env.VITE_AGENTVIEW_WEBAPP_URL
      ?? process.env.AGENTVIEW_WEBAPP_URL;
    if (url) return url;
  }
  return PRODUCTION_WEBAPP_URL;
}

/**
 * Get AgentView Email Domain
 */
export function getEmailDomain(): string {
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AGENTVIEW_EMAIL_DOMAIN) {
    // @ts-ignore
    return import.meta.env.VITE_AGENTVIEW_EMAIL_DOMAIN;
  }
  if (typeof process !== 'undefined') {
    const url = process.env.NEXT_PUBLIC_AGENTVIEW_EMAIL_DOMAIN
      ?? process.env.VITE_AGENTVIEW_EMAIL_DOMAIN
      ?? process.env.AGENTVIEW_EMAIL_DOMAIN;
    if (url) return url;
  }
  return PRODUCTION_EMAIL_DOMAIN;
}
