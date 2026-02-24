import { defineChannel } from '../defineChannel';
import { createMockEmailRoutes } from './routes';

export const mockEmailChannel = defineChannel({
  type: 'mock-email',
  routes: (provider) => createMockEmailRoutes(provider),
});
