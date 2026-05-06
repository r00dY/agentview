import { defineEmailChannel } from '../defineEmailChannel';
import { createResendRoutes } from './routes';

export const resendChannel = defineEmailChannel({
  type: 'resend',
  routes: () => createResendRoutes(),
  sendEmail: () => async () => {
    console.log('!!!!!!!!!!!!!!! RESEND: SEND EMAIL !!!!!!!!!!!!!!!');

    return {
      sourceId: crypto.randomUUID()
    };
  },
});
