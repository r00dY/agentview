import { createTestAuthClient } from './authClient'

export async function seedUsers(slug_: string) {
  const slug = "test-agentview-" + slug_;

  const authClient = createTestAuthClient();

  // First sign up - admin user
  const admin = await authClient.signUp.email({
    email: `admin@${slug}.com`,
    password: "blablabla",
    name: "Admin"
  });

  // Admin's personal organization is created automatically on signup, reuse it.
  const organizations = await authClient.organization.list();
  const organization = organizations[0];

  if (!organization) {
    throw new Error("Expected admin's personal organization to be auto-created on signup");
  }

  // Create an org-level API key pair (secret + public). Keys are owned by the
  // organization (apiKey plugin `references: "organization"`), so we pass organizationId.
  // The two keys are linked into a pair via a shared metadata.pairId.
  const pairId = crypto.randomUUID();

  const apiKeySecret = await authClient.apiKey.create({
    name: "Test key pair",
    prefix: 'sk_',
    organizationId: organization.id,
    metadata: { pairId, type: 'secret' }
  })

  const apiKeyPublic = await authClient.apiKey.create({
    name: "Test key pair",
    prefix: 'pk_',
    organizationId: organization.id,
    metadata: { pairId, type: 'public' }
  })

  // Invite Bob and Alice
  const bobInvitation = await authClient.organization.inviteMember({
    email: `bob@${slug}.com`,
    role: "member",
    organizationId: organization.id
  })

  const aliceInvitation = await authClient.organization.inviteMember({
    email: `alice@${slug}.com`,
    role: "member",
    organizationId: organization.id
  })

  await authClient.signOut();

  // Register Bob
  await authClient.signUp.email({
    email: `bob@${slug}.com`,
    password: "blablabla",
    name: "Bob",
    // @ts-ignore
    invitationId: bobInvitation.id
  });

  await authClient.organization.acceptInvitation({
    invitationId: bobInvitation.id
  }) // accept invitation

  await authClient.signOut();

  // Register Alice
  await authClient.signUp.email({
    email: `alice@${slug}.com`,
    password: "blablabla",
    name: "Alice",
    // @ts-ignore
    invitationId: aliceInvitation.id
  });

  await authClient.organization.acceptInvitation({
    invitationId: aliceInvitation.id
  }) // accept invitation

  await authClient.signOut();

  // Sign back in as admin to obtain a fresh, valid session token. The token returned
  // at signup was invalidated by the signOut above. This token works as a Bearer token
  // (bearer plugin) and is used to build a member-principal client in tests.
  const adminSignIn = await authClient.signIn.email({
    email: `admin@${slug}.com`,
    password: "blablabla",
  });
  const adminSessionToken = adminSignIn.token;

  return {
    organization,

    // org-level API key pair
    apiKeySecret,
    apiKeyPublic,

    // admin's session token, for building a member-principal client
    adminSessionToken,

    admin: {
      ...admin
    }
  }
}