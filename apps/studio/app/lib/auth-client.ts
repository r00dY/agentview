import { createAuthClient } from "better-auth/react"
import { adminClient } from "better-auth/client/plugins"
import { getAPIBaseUrl } from "./getAPIBaseUrl"

export const authClient = createAuthClient({
    baseURL: getAPIBaseUrl() + '/api/auth', // The base URL of your auth server,
    plugins: [
        adminClient()
    ]
})
