import { createAuthClient } from "better-auth/react"
import { adminClient, apiKeyClient, organizationClient } from "better-auth/client/plugins"
import { config } from "../config"
import { data, redirect } from "react-router"
import { getApiUrl } from "agentview/urls"
import { swr } from "./swr-cache"

export function createBetterAuthClient({ baseURL }: { baseURL: string }) {
    return createAuthClient({
        baseURL,
        plugins: [
            apiKeyClient(),
            organizationClient()
        ],
        fetchOptions: {
            // headers: {
            //     "X-Organization-Id": config.organizationId
            // },
            auth: {
                type: "Bearer",
                token: () => localStorage.getItem("agentview_token") || ""
            }
        }
    })
}

export const authClient = createBetterAuthClient({ baseURL: new URL('/api/auth', getApiUrl()).toString() })


export async function getOrganization() {
    const response = await authClient.organization.getFullOrganization({ query: { organizationId: config.organizationId } })

    if (response.error) {
        if (response.error.code === "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION") {
            throw data({ message: "You don't have access to this organization." });
        }
        throw data(response.error, 400);
    }

    return response.data;
}

export async function getMember(organization: Organization, userId: string) {
    const member = organization.members.find((member) => member.userId === userId);

    if (!member) {
        throw new Error("Member not found");
    }

    return member;
}

export async function getSession() {
    const response = await authClient.getSession()
    if (response.error) {
        throw data(response.error, 400);
    }

    return response.data;
}

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
export type Member = Awaited<ReturnType<typeof getMember>>;
export type User = Session["user"];
export type Organization = Awaited<ReturnType<typeof getOrganization>>;

// Cached versions with stale-while-revalidate
export async function getSessionCached() {
    return swr('auth:session', async () => {
        const response = await authClient.getSession();
        if (response.error) {
            throw response.error;
        }
        return response.data;
    });
}

export async function getOrganizationCached() {
    return swr('auth:organization', async () => {
        const response = await authClient.organization.getFullOrganization({
            query: { organizationId: config.organizationId }
        });
        if (response.error) {
            if (response.error.code === "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION") {
                throw new Error("You don't have access to this organization.");
            }
            throw response.error;
        }
        return response.data;
    });
}
