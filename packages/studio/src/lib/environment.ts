import { data } from "react-router";
import { agentview } from "./agentview";


export async function requireEnvironment() {
    const environment = await agentview().getEnvironment();
    if (!environment) {
        throw data({ message: "Environment not found." });
    }
    return environment;
}