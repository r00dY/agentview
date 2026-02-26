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

/** In-memory outbox for testing — stores all outgoing messages sent via mock channel */
export const mockOutbox: MockOutboxEntry[] = [];

export const mockChannel = defineChannel({
  type: 'mock',
  routes: (provider) => createMockRoutes(provider),
  sendMessage: (_provider) => async ({ channelThread, channel, message }) => {
    console.log(`[mock] Sending outgoing message to ${channelThread.contact} on channel ${channel.address}: ${message.text?.substring(0, 100) ?? '(empty)'}`);

    const sourceId = `mock-${message.id}`

    mockOutbox.push({
      id: sourceId,
      address: channel.address,
      contact: channelThread.contact,
      contactKind: channelThread.contactKind,
      text: message.text,
      timestamp: Date.now(),
    });
    return { sourceId };
  },
});
