import { createAuthClient } from "better-auth/react"
import { adminClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
    baseURL: import.meta.env.VITE_AGENTVIEW_API_BASE_URL + '/api/auth', // The base URL of your auth server,
    plugins: [
        adminClient()
    ]
})
