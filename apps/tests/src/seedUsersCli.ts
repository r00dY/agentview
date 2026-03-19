import { updateEnv } from '@agentview/utils/updateEnv'
import { seedUsers } from './seedUsers';

async function main() {
  const { apiKeySecret, apiKeyPublic, organization, adminUser } = await seedUsers("acme");

  // console.log('Organization id: ' + organization.id)

  // updateEnv("AGENTVIEW_ORGANIZATION_ID", organization.id, { includeExamples: false });
  // updateEnv("VITE_AGENTVIEW_ORGANIZATION_ID", organization.id, { includeRoot: false });

  // Let's write the API key to the .env file
  // console.log('API Key: ' + apiKeySecret.key)

  updateEnv("AGENTVIEW_API_KEY", apiKeySecret.key, { includeRoot: false });
  updateEnv("NEXT_PUBLIC_AGENTVIEW_API_KEY", apiKeyPublic.key, { includeRoot: false });
  updateEnv("NEXT_PUBLIC_AGENTVIEW_ORGANIZATION_ID", organization.id, { includeRoot: false });
  updateEnv("NEXT_PUBLIC_AGENTVIEW_ENV", "dev:"+adminUser.email, { includeRoot: false });
}

main().catch(console.error);