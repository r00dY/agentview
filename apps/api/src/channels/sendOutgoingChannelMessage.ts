import { withOrg } from "../withOrg";
import { log, setContext } from "../logger";
import { channelMessages, channelThreads } from "../schemas/schema";
import { eq } from "drizzle-orm";
import { db__dangerous } from "../db";
import { channelApps } from "./registry";
import { createRunForChannelThreadIfNecessary } from "./channelRuns";

export async function sendOutgoingChannelMessage(messageId: string, organizationId: string) {
    setContext({ channelMessageId: messageId, organizationId });

    const message = await withOrg(organizationId, async (tx) => {
        return tx.query.channelMessages.findFirst({
            where: eq(channelMessages.id, messageId),
        });
    });

    if (!message) {
        throw new Error(`Channel message ${messageId} not found`);
    }

    log.info({ textPreview: message.text?.substring(0, 100) ?? '(empty)' }, 'processing outgoing message');

    try {
        const channelThread = await db__dangerous.query.channelThreads.findFirst({
            where: eq(channelThreads.id, message.channelThreadId),
            with: {
                channel: true,
            },
        });

        if (!channelThread) {
            throw new Error(`Channel thread ${message.channelThreadId} not found`);
        }

        const channel = channelThread.channel;
        const channelApp = channelApps.find((app) => app.type === channel.type);
        const sendFn = channelApp?.sendMessage;

        if (!sendFn) {
            throw new Error(`No send function registered for channel type '${channel.type}'`);
        }

        log.info('sending outgoing message');

        const result = await sendFn({ channel, channelThread, message });

        log.info({ sourceId: result.sourceId }, 'message sent');

        await withOrg(organizationId, async (tx) => {
            await tx.update(channelMessages).set({
                status: 'sent',
                ...(result?.sourceId ? { sourceId: result.sourceId } : {}),
                ...(result?.providerData ? { providerData: result.providerData } : {}),
                updatedAt: new Date().toISOString(),
            }).where(eq(channelMessages.id, messageId));
        });

        log.info('outgoing message sent and saved');

        // Re-trigger run creation in case incoming messages arrived while this
        // outgoing was pending/sending. Only for non-internal messages — internal
        // messages (error notifications) must not retrigger to avoid infinite loops
        // (failed run → error msg → retrigger → failed run → ...).
        if (!message.internal) {
            createRunForChannelThreadIfNecessary(message.channelThreadId);
        }
    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        log.error({ err: e }, `failed to send message: ${errorMessage}`);

        await withOrg(organizationId, async (tx) => {
            await tx.update(channelMessages).set({
                status: 'failed',
                failReason: { message: errorMessage },
                updatedAt: new Date().toISOString(),
            }).where(eq(channelMessages.id, messageId));
        });

        throw e; // re-throw so pg-boss retries
    }
}