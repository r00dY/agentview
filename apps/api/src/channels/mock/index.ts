import { log } from '../../logger';
import { defineChannel } from '../defineChannel';
import { createMockRoutes } from './routes';

export type MockOutboxEntry = {
  id: string; // source_id
  address: string;
  contact: string;
  contactKind: string;
  text: string | null;
  timestamp: number;
};

/** In-memory outbox for testing — lives in the HTTP server process */
export const mockOutbox: MockOutboxEntry[] = [];

const apiPort = process.env.AGENTVIEW_API_PORT ?? '80';

export const mockChannel = defineChannel({
  type: 'mock',
  routes: (provider) => createMockRoutes(provider),
  sendMessage: (_provider) => async ({ channelThread, channel, message }) => {
    log.info({ contact: channelThread.contact, address: channel.address }, 'mock: sending outgoing message');

    const sourceId = `mock-${message.id}`

    const entry: MockOutboxEntry = {
      id: sourceId,
      address: channel.address,
      contact: channelThread.contact,
      contactKind: channelThread.contactKind,
      text: message.text,
      timestamp: Date.now(),
    };

    // POST to the HTTP server so the outbox is readable via GET /outbox
    // (sendMessage runs in the worker process, separate from the HTTP server)
    await fetch(`http://localhost:${apiPort}/api/channels/mock/outbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });

    return { sourceId };
  },
});
