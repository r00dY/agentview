import type { SessionItem, StandardSession, UIMessage } from 'agentview/apiTypes';
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


function getItemBase(item: SessionItem) {
    const { content, ...itemBase } = item;
    return itemBase;
}

function sessionToUIMessages(session: StandardSession): UIMessage[] {
    const messages: UIMessage[] = [];

    for (const run of session.runs) {
        if (run.agentRef?.adapter !== "ai-sdk") {
            throw new Error("[sessionToUIMessages] Run is not an AI SDK run");
        }

        const { sessionItems, ...runBase } = run;

        const [inputItem, ...outputParts] = sessionItems;

        messages.push({
            ...inputItem.content,
            _run: runBase,
            _item: getItemBase(inputItem),
        });

        if (!isRunFinished(run)) {
            continue;
        }

        const assistantMessageId = run.metadata?.assistantMessage?.id;
        const assistantMessageMetadata = run.metadata?.assistantMessage?.metadata;

        if (!assistantMessageId) {
            throw new Error("[sessionToUIMessages] Assistant message ID is required");
        }

        messages.push({
            id: assistantMessageId,
            metadata: assistantMessageMetadata,
            role: 'assistant',
            parts: outputParts.map(part => ({
                ...part.content,
                _item: getItemBase(part),
            })),
            // @ts-ignore
            _run: runBase,
        })
    }

    return messages;
}
