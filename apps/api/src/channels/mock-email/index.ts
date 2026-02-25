import { defineChannel } from '../defineChannel';
import { createMockEmailRoutes } from './routes';

export const mockEmailChannel = defineChannel({
  type: 'mock-email',
  routes: (provider) => createMockEmailRoutes(provider),
  sendMessage: (_provider) => async ({ channelThread, channel, message }) => {
    console.log(`[mock-email] Sending outgoing message to ${channelThread.contact} on channel ${channel.address}: ${message.text?.substring(0, 100) ?? '(empty)'}`);
    return { sourceId: `mock-${message.id}` };
  },
});
