import { withOrg } from "../withOrg";
import { channels } from "../schemas/schema";
import { db__dangerous } from "../db";
import { eq, and } from "drizzle-orm";

export async function createChannel(orgId: string, type: string, address: string, config: any, environmentId: string | null = null) {
    return withOrg(orgId, async (tx) => {
        const [channel] = await tx
            .insert(channels)
            .values({
                organizationId: orgId,
                type,
                address,
                config: config ?? {},
                environmentId
            })
            .returning();

        return channel;
    });
}

export async function getChannel(type: string, address: string) {

    const channelRows = await db__dangerous.query.channels.findMany({
        where: and(eq(channels.type, type), eq(channels.address, address)),
        with: {
            environment: {
                with: {
                    user: true,
                },
            }
        },
    });

    if (channelRows.length === 0) {
        return null;
    }

    if (channelRows.length > 1) {
        throw new Error(`Multiple channels found for type=${type} address=${address}. THIS IS VERY SEVERE ERROR.`);
    }

    return channelRows[0]!;
}