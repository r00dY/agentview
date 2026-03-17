import type { RunBody, Session } from 'agentview/apiTypes';
import { callAgentAPI, type AgentAPIEvent } from './agentApi';
import { callAgentAPIAISDK } from './ai-sdk/agentApi';
import { sessionToUIMessages } from './ai-sdk/mapping';

export interface Adapter {
  callAgent: (body: RunBody, url: string, signal?: AbortSignal) => AsyncGenerator<AgentAPIEvent, void, unknown>;
  enrichSession: (session: Session) => Record<string, any>;
}

const adapters: Record<string, Adapter> = {
  agentview: {
    callAgent: callAgentAPI,
    enrichSession: () => ({}),
  },
  'ai-sdk': {
    callAgent: callAgentAPIAISDK,
    enrichSession: (session) => ({
      messages: sessionToUIMessages(session),
    }),
  },
};

const defaultAdapter = adapters.agentview;

export function getAdapter(name?: string): Adapter {
  if (!name) return defaultAdapter;
  return adapters[name] ?? defaultAdapter;
}
