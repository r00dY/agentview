import 'dotenv/config';
import { auth } from './auth.server';
import { user } from 'db/auth-schema';

async function run() {
  console.log('Seeding database...');

  const create_user_result = await auth.api.signInEmail({
    returnHeaders: true,
    body: {
      email: "admin@admin.com",
      password: "Dupa123!",
    },
  });

  const browserHeaders = create_user_result.headers;
  const user = create_user_result.response.user;

  // simulate real headers
  const cookie = browserHeaders.get('set-cookie');
  if (!cookie) {
    throw new Error('No session cookie found in sign-up response.');
  }
  const headers = new Headers();
  headers.append('cookie', cookie);

  await auth.api.acceptInvitation({
    headers,
    body: {
      invitationId: "tSuAiGNOKzaPtXmdR9cKzvunpF7Hglfd",
    },
  });
  

  process.exit(0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
