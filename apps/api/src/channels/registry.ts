import { gmailChannel } from './gmail/index';
import { mockChannel } from './mock/index';
import { resendChannel } from './resend/index';

export const channelApps = [gmailChannel, mockChannel, resendChannel];
