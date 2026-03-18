import type { RunBody, Session } from 'agentview/apiTypes';
import { callAgentAPI, type AgentAPIEvent } from '../agentApi';
import { aiSDKAdapter } from './ai-sdk';

export interface Adapter {
  callAgent: (body: RunBody, url: string, signal?: AbortSignal) => AsyncGenerator<AgentAPIEvent, void, unknown>;
  enrichSession: (session: Session) => Record<string, any>;
}

const adapters: Record<string, Adapter> = {
  agentview: {
    callAgent: callAgentAPI,
    enrichSession: () => ({}),
  },
  'ai-sdk': aiSDKAdapter,
};

const defaultAdapter = adapters.agentview;

export function getAdapter(name?: string): Adapter {
  if (!name) return defaultAdapter;
  return adapters[name] ?? defaultAdapter;
}
