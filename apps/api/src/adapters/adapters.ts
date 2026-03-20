import type { RunBody, Session } from 'agentview/apiTypes';
import { callAgentAPI, type AgentAPIEvent } from '../agentApi';
import { aiSDKAdapter } from './ai-sdk';

export interface Adapter {
  callAgent: (body: RunBody, url: string, signal?: AbortSignal) => AsyncGenerator<AgentAPIEvent, void, unknown>;
  enrichSession: (session: Session) => Record<string, any>;
}

const agentviewAdapter = {
  callAgent: callAgentAPI,
  enrichSession: () => ({}),
} satisfies Adapter;

export const adapters = {
  agentview: agentviewAdapter,
  'ai-sdk': aiSDKAdapter,
} satisfies Record<string, Adapter>;

const defaultAdapter = adapters.agentview;

export function getAdapter(name?: string) {
  if (!name) return defaultAdapter;
  return adapters[name as keyof typeof adapters] ?? defaultAdapter;
}
