'use client';

import { createClient } from "agentview";
import { getCookie, setCookie } from 'cookies-next/client';

export const client = createClient({
    apiKey: process.env.NEXT_PUBLIC_AGENTVIEW_PUBLIC_API_KEY!,
    env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
});

export const getUserToken = () => {
    return getCookie("agentview-user-token");
};

export const setUserToken = (token: string) => {
    setCookie("agentview-user-token", token, { path: "/" });
};
