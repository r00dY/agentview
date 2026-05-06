import { OpenAPIHono } from '@hono/zod-openapi';
import { log } from '../../logger';

export function createResendRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();

  app.post('/webhook', async (c) => {
    const body = await c.req.json();
    log.info({ body }, 'resend webhook received');
    return c.json({ status: 'ok' }, 200);
  });

  return app;
}
