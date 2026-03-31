import type { RunBody, StandardSession } from 'agentview/apiTypes';
import { aiSDKAdapter } from './ai-sdk';

export interface Adapter {
  callAgent: (body: RunBody, url: string, send: (event: { name: string, data: any }) => Promise<void>, signal?: AbortSignal) => Promise<void>;
  enrichSession: (session: StandardSession) => Record<string, any>;
  createDefaultInputForChannelMessages: (channelMessages: any[], runId: string) => any;
}

const agentviewAdapter = {
  callAgent: null as any, // temporarily disabled
  enrichSession: () => ({}),
  createDefaultInputForChannelMessages: () => {
    throw new Error('createDefaultInput not implemented');
  }
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
