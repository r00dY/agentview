import { defineChannel } from '../defineChannel';
import { createMockRoutes } from './routes';

export const mockChannel = defineChannel({
  type: 'mock',
  routes: (provider) => createMockRoutes(provider),
  sendMessage: (_provider) => async ({ channelThread, channel, message }) => {
    console.log(`[mock] Sending outgoing message to ${channelThread.contact} on channel ${channel.address}: ${message.text?.substring(0, 100) ?? '(empty)'}`);
    return { sourceId: `mock-${message.id}` };
  },
});
