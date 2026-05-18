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
    createDefaultInputForChannelMessages: (incomingMessages: any[]) => {
        return {
            id: crypto.randomUUID(),
            role: 'user',
            parts: incomingMessages.map(cm => ({ type: 'text', text: cm.text ?? '' })),
        };
    }
} satisfies Adapter;



function sessionToUIMessages(session: StandardSession): UIMessage[] {
    const messages: UIMessage[] = [];
    const allChannelMessages = session.channelMessages ?? [];

    for (const run of session.runs) {
        if (run.agent?.adapter !== "ai-sdk") {
            throw new Error("[sessionToUIMessages] Run is not an AI SDK run");
        }

        const { sessionItems } = run;

        const [inputItem, ...outputParts] = sessionItems;

        // const incomingMessages = session.channel.type === 'api'
        //     ? undefined
        //     : getRunIncomingMessages(allChannelMessages, run);

        messages.push(inputItem.content);

        if (!isRunFinished(run)) {
            continue;
        }

        const { assistantMessage, ...metadata } = run.metadata ?? {};

        const assistantMessageId = assistantMessage?.id;
        const assistantMessageMetadata = assistantMessage?.metadata;

        if (!assistantMessageId) {
            throw new Error("[sessionToUIMessages] Assistant message ID is required");
        }

        messages.push({
            id: assistantMessageId,
            metadata: {
                ...assistantMessageMetadata,
                _agentview: {
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
