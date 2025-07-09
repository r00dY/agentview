import 'dotenv/config';
import { auth } from './auth.server';
import { user } from 'db/auth-schema';

async function seed() {
  console.log('Seeding database...');

  const create_user_result = await auth.api.signUpEmail({
    returnHeaders: true,
    body: {
      email: "admin@admin.com",
      password: "adminadmin",
      name: "Admin"
    },
  });

  const browserHeaders = create_user_result.headers;
  const user = create_user_result.response.user;
  const token = create_user_result.response.token;

  // simulate real headers
  const cookie = browserHeaders.get('set-cookie');
  if (!cookie) {
    throw new Error('No session cookie found in sign-up response.');
  }
  const headers = new Headers();
  headers.append('cookie', cookie);

  console.log('✅ Admin user created', user);


  // if (!response.token) {
  //   throw new Error('No token');
  // }

  // console.log('token', response.token);
  // console.log('user', response.user);

  // await auth.api.verifyEmail({
  //   headers: headers,
  //   query: {
  //     token: token as string,
  //   }
  // });

  // console.log('✅ Admin user verified');


  // console.log('✅ Admin user created');

  const ORG_SLUG = 'default';

  const org = await auth.api.createOrganization({
    headers,
    body: {
      name: 'Default',
      slug: ORG_SLUG,
    },
  });

  if (!org) {
    throw new Error('Failed to create organization');
  }

  console.log('✅ Default organization created', org);

  process.exit(0);
}

seed().catch((e) => {
    console.error(e);
    process.exit(1);
});
