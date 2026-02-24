import { OpenAPIHono } from '@hono/zod-openapi';
import type { WorkerHandle } from '../workers/utils';
import { channelProvider } from './operations';

type ChannelProvider = ReturnType<typeof channelProvider>;

export interface ChannelApp {
  type: string;
  routes: OpenAPIHono | null;
  workers: WorkerHandle[];
}

export function defineChannel(config: {
  type: string;
  routes?: (provider: ChannelProvider) => OpenAPIHono;
  workers?: (provider: ChannelProvider) => WorkerHandle[];
}): ChannelApp {
  const provider = channelProvider(config.type);
  return {
    type: config.type,
    routes: config.routes ? config.routes(provider) : null,
    workers: config.workers ? config.workers(provider) : [],
  };
}
