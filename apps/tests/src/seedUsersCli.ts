import { updateEnv, updateEnvFile } from '@agentview/utils/updateEnv'
import { seedUsers } from './seedUsers';

async function main() {
  const { apiKeySecret, apiKeyPublic, admin } = await seedUsers("acme");

  // console.log('Organization id: ' + organization.id)

  // updateEnv("AGENTVIEW_ORGANIZATION_ID", organization.id, { includeExamples: false });
  // updateEnv("VITE_AGENTVIEW_ORGANIZATION_ID", organization.id, { includeRoot: false });

  // Let's write the API key to the .env file
  console.log('Secret API Key: ' + apiKeySecret.key)
  console.log('Public API Key: ' + apiKeyPublic.key)

  const demoAiSDKPath = "apps/examples/ai-sdk-demo/.env.local";
  updateEnv(demoAiSDKPath, "AGENTVIEW_API_KEY", apiKeySecret.key);
  updateEnv(demoAiSDKPath, "NEXT_PUBLIC_AGENTVIEW_API_KEY", apiKeyPublic.key);
  updateEnv(demoAiSDKPath, "NEXT_PUBLIC_AGENTVIEW_ENV", "local-admin");

  // updateEnv("AGENTVIEW_API_KEY", apiKeySecret.key, { includeRoot: false });
  // updateEnv("NEXT_PUBLIC_AGENTVIEW_API_KEY", apiKeyPublic.key, { includeRoot: false });
  // updateEnv("NEXT_PUBLIC_AGENTVIEW_ENV", "local-admin", { includeRoot: false });
}

main().catch(console.error);