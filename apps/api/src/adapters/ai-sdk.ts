import type { StandardSession, UIMessage } from 'agentview/apiTypes';
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


function sessionToUIMessages(session: StandardSession): UIMessage[] {
    const messages: UIMessage[] = [];

    for (const run of session.runs) {
        if (run.agentRef?.adapter !== "ai-sdk") {
            throw new Error("[sessionToUIMessages] Run is not an AI SDK run");
        }

        const [inputItem, ...outputParts] = run.sessionItems;

        messages.push({
            ...inputItem.content,
            _runId: run.id,
            _sessionItemId: inputItem.id,
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
                _sessionItemId: part.id,
            })),
            // @ts-ignore
            _runId: run.id,
            _agentRef: {
                agent: run.agentRef!.agent,
                version: run.agentRef!.version,
            },
        })
    }

    return messages;
}
