import type { ChannelMessage, SessionItem, StandardRun, StandardSession, UIMessage } from 'agentview/apiTypes';
import { isRunFinished } from '../runs';
import { getSessionStatusFields } from '../sessions';
import { type Adapter } from './adapters';


export const aiSDKAdapter = {
    enrichSession: (session: StandardSession) => {
        const messages = sessionToUIMessages(session);
        const statusFields = getSessionStatusFields(session);
        return {
            messages,
            ...statusFields,
            resume: statusFields.status === 'in_progress',
        }
    },
    createDefaultInputForChannelMessages: (incomingMessages: any[], runId: string) => {
        return {
            id: `${runId}-input`,
            role: 'user',
            parts: incomingMessages.map(cm => ({ type: 'text', text: cm.text ?? '' })),
        };
    }
} satisfies Adapter;

function getRunIncomingMessages(allMessages: ChannelMessage[], run: StandardRun): ChannelMessage[] {
    if (!run.firstIncomingChannelMessageId || !run.lastIncomingChannelMessageId) return [];
    const first = allMessages.find(m => m.id === run.firstIncomingChannelMessageId);
    const last = allMessages.find(m => m.id === run.lastIncomingChannelMessageId);
    if (!first || !last) return [];
    // Filter by createdAt range (handles out-of-order dates)
    return allMessages.filter(m =>
        m.direction === 'incoming' &&
        m.createdAt >= first.createdAt &&
        m.createdAt <= last.createdAt
    );
}

function sessionToUIMessages(session: StandardSession): UIMessage[] {
    const messages: UIMessage[] = [];
    const allChannelMessages = session.channelMessages ?? [];

    for (const run of session.runs) {
        if (run.agent?.adapter !== "ai-sdk") {
            throw new Error("[sessionToUIMessages] Run is not an AI SDK run");
        }

        const { sessionItems } = run;

        const [inputItem, ...outputParts] = sessionItems;

        const incomingMessages = session.channel.type === 'api'
            ? undefined
            : getRunIncomingMessages(allChannelMessages, run);

        messages.push({
            ...inputItem.content,
            metadata: {
                ...inputItem.content.metadata,
                _agentview: {
                    channelMessages: incomingMessages,
                }
            }
        });

        if (!isRunFinished(run)) {
            continue;
        }

        const { assistantMessage, ...metadata } = run.metadata ?? {};

        const assistantMessageId = assistantMessage?.id;
        const assistantMessageMetadata = assistantMessage?.metadata;

        if (!assistantMessageId) {
            throw new Error("[sessionToUIMessages] Assistant message ID is required");
        }

        const outgoingMessage = run.outgoingChannelMessageId
            ? allChannelMessages.find(m => m.id === run.outgoingChannelMessageId)
            : undefined;

        messages.push({
            id: assistantMessageId,
            metadata: {
                ...assistantMessageMetadata,
                _agentview: {
                    channelMessage: outgoingMessage,
                    id: run.id,
                    status: run.status,
                    failReason: run.failReason,
                    createdAt: run.createdAt,
                    finishedAt: run.finishedAt,
                    agent: run.agent,
                    metadata,
                }
            },
            role: 'assistant',
            parts: outputParts.map(part => ({
                ...part.content,
            })),
        })
    }

    return messages;
}
