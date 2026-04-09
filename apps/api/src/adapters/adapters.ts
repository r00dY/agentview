import type { StandardSession } from 'agentview/apiTypes';
import { aiSDKAdapter } from './ai-sdk';

export interface Adapter {
  enrichSession: (session: StandardSession) => Record<string, any>;
  createDefaultInputForChannelMessages: (channelMessages: any[], runId: string) => any;
}

const agentviewAdapter = {
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
