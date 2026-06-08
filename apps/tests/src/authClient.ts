import { createAuthClient } from "better-auth/client"
import { apiKeyClient, organizationClient } from "better-auth/client/plugins"

if (!process.env.AGENTVIEW_API_URL) {
  throw new Error('AGENTVIEW_API_URL is not set')
}

export function createTestAuthClient() {
  const authHeaders = new Headers();

  const authClient = createAuthClient({
    baseURL: process.env.AGENTVIEW_API_URL + "/api/auth",
    plugins: [
        apiKeyClient(),
        organizationClient()
    ],
    fetchOptions: {
      onSuccess({ response }) {
        const setCookieHeader = response.headers.get("set-cookie");
        if (setCookieHeader) {
          // Parse the set-cookie header to extract cookie values
          // Format: "cookieName=value; Path=/; HttpOnly; ..."
          // Multiple cookies may be separated by commas
          const cookies = setCookieHeader.split(',').map(cookie => {
            // Extract just the name=value part (before the first semicolon)
            return cookie.split(';')[0].trim();
          });
          // Set the Cookie header with all extracted cookies
          authHeaders.set("Cookie", cookies.join('; '));
        }
      },
      headers: authHeaders,
      throw: true
    },
  })

  return authClient;
}
