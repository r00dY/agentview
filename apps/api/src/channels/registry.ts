import { gmailChannel } from './gmail/index';
import { mockEmailChannel } from './mock-email/index';
import type { SendMessageFn } from './defineChannel';

export const channelApps = [gmailChannel, mockEmailChannel];

export const channelSendRegistry = new Map<string, SendMessageFn>();

for (const app of channelApps) {
  if (app.sendMessage) {
    channelSendRegistry.set(app.type, app.sendMessage);
  }
}
