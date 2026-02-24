import { defineChannel } from '../defineChannel';
import { createGmailRoutes } from './routes';
import { createGmailWorkers } from './worker';

export const gmailChannel = defineChannel({
  type: 'gmail',
  routes: (provider) => createGmailRoutes(provider),
  workers: (provider) => createGmailWorkers(provider),
});
