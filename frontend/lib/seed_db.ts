import { auth } from './auth.server';

await auth.api.createUser({
  body: {
    email: 'admin@admin.com',
    password: 'admin',
    name : 'admin',
    role : 'admin'
  },
});

console.log(`✅  Admin seeded`);
process.exit(0);
