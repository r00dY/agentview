import { createTestAuthClient } from './authClient'

export async function seedUsers(slug: string) {
  const authClient = createTestAuthClient();

  // First sign up - admin user
  const admin = await authClient.signUp.email({
    email: `admin@${slug}.com`,
    password: "blablabla",
    name: "Admin"
  });

  // Create organization (for now this way)
  const organization = await authClient.organization.create({
    name: slug,
    slug
  })
  
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
    name: "Bob"
  });

  await authClient.organization.acceptInvitation({
    invitationId: bobInvitation.id
  }) // accept invitation

  await authClient.signOut();

  // Register Alice
  await authClient.signUp.email({
    email: `alice@${slug}.com`,
    password: "blablabla",
    name: "Alice"
  });

  await authClient.organization.acceptInvitation({
    invitationId: aliceInvitation.id
  }) // accept invitation

  await authClient.signOut();

  return {
    organization,
    apiKeySecret,
    apiKeyPublic,
    adminUser: admin.user
  }
}