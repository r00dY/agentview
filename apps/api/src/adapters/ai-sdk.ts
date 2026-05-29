import type { StandardSession, UIMessage } from 'agentview/apiTypes';
import { isRunFinished } from '../runs';
import { type Adapter } from './adapters';
import { channelMessages } from 'src/schemas/schema';

type ChannelMessage = typeof channelMessages.$inferSelect;

type StrippedChannelMessage = Pick<ChannelMessage, 'text' | 'authorEmail' | 'authorName' | 'authorHeadline' | 'authorDetails' | 'providerData' | 'date'>;

export const aiSDKAdapter = {
    enrichSession: (session: StandardSession) => {
        const messages = sessionToUIMessages(session);
        const lastRun = session.runs[session.runs.length - 1];
        // const statusFields = getSessionStatusFields(session);
        return {
            messages,
            isRunning: lastRun?.status === 'in_progress',
            // ...statusFields
        }
    },
    createDefaultInputForChannelMessages: (incomingMessages: ChannelMessage[]) => {

        const _channelMessages : StrippedChannelMessage[] = incomingMessages.map(cm => ({
            text: cm.text,
            authorEmail: cm.authorEmail,
            authorName: cm.authorName,
            authorHeadline: cm.authorHeadline,
            authorDetails: cm.authorDetails,
            providerData: cm.providerData,
            date: cm.date,
        }));

        const fullMessageText = _channelMessages.map(cm => {
            let messageText = '---\n'
            messageText += `date: ${cm.date}\n`
            if (cm.authorName) {
                messageText += `author_name: ${cm.authorName}\n`
            }
            if (cm.authorEmail) {
                messageText += `author_email: ${cm.authorEmail}\n`
            }
            if (cm.authorHeadline) {
                messageText += `author_headline: ${cm.authorHeadline}\n`
            }
            if (cm.authorDetails) {
                messageText += `author_details: |\n`
                messageText += `${cm.authorDetails}\n`;
            }
            messageText += '---\n\n'
            messageText += `${cm.text}`
            return messageText;
        }).join('\n\n\n');

        return {
            id: crypto.randomUUID(),
            role: 'user',
            parts: [
                { type: 'text', text: fullMessageText }
            ],
            metadata: {
                _channelMessages
            }
        };
    }
} satisfies Adapter;


function sessionToUIMessages(session: StandardSession): UIMessage[] {
    const messages: UIMessage[] = [];

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
                    reason: run.reason,
                    createdAt: run.createdAt,
                    finishedAt: run.finishedAt,
                    agent: {
                        name: run.agent.name,
                        version: run.agent.version,
                    },
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
