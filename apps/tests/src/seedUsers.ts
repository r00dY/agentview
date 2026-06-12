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
  
  // Create API keys for admin user
  const apiKeySecret = await authClient.apiKey.create({
    name: "Test secret key",
    prefix: 'sk_',
    metadata: {
      organizationId: organization.id,
      type: 'secret'
    }
  })

  const apiKeyPublic = await authClient.apiKey.create({
    name: "Test public key",
    prefix: 'pk_',
    metadata: {
      organizationId: organization.id,
      type: 'public'
    }
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
    invitationId: aliceInvitation.id
  });

  await authClient.organization.acceptInvitation({
    invitationId: aliceInvitation.id
  }) // accept invitation

  await authClient.signOut();

  return {
    organization,

    // keys are created by users but are org-level for now
    apiKeySecret, 
    apiKeyPublic,

    admin: {
      ...admin
    }
  }
}