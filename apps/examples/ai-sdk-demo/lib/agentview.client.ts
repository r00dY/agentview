'use client';

import { createClient } from "agentview";
import { getCookie, setCookie } from 'cookies-next/client';

export const client = createClient({
    apiKey: process.env.NEXT_PUBLIC_AGENTVIEW_API_KEY!,
    env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
});

export const getUserToken = () => {
    return getCookie("av-user-token");
};

export const setUserToken = (token: string) => {
    setCookie("av-user-token", token, { path: "/" });
};

export const createUserToken = async () => {
    const user = await client.createUser();
    setUserToken(user.token);
    return user.token;
};