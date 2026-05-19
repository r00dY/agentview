import { log } from '../../logger';
import { defineChannelApp } from '../defineChannel';
import { createMockRoutes } from './routes';
import { type MockOutboxEntry } from './mockOutbox';


const apiPort = process.env.AGENTVIEW_API_PORT ?? '80';

export const mockChannel = defineChannelApp(
  'mock',
  (provider) => ({
    routes: createMockRoutes(provider),
    sendMessage: async ({ address, text, sourceThreadId }) => {
      log.info({ address }, 'mock: sending outgoing message');

      const sourceId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const entry: MockOutboxEntry = {
        sourceId,
        sourceThreadId,
        address,
        text,
        timestamp: Date.now(),
      };

      // IMPORTANT!!!! It's not in-memory because there are SEPARATE PROCESSES.
      // 
      // POST to the HTTP server so the outbox is readable via GET /outbox
      // (sendMessage runs in the worker process, separate from the HTTP server)
      await fetch(`http://localhost:${apiPort}/api/channels/mock/outbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });

      return { sourceId };
    },
  }))

