export interface AgentViewGeneralErrorDetails {
    code?: undefined
    cause?: any
    [key: string]: any
}

export interface AgentViewParseErrorDetails {
    code: "parse.schema"
    issues: any,
}

export type AgentViewErrorDetails = AgentViewGeneralErrorDetails | AgentViewParseErrorDetails;

export class AgentViewError extends Error {
    details?: AgentViewErrorDetails
    statusCode: number

    constructor(message: string, statusCode: number, details?: AgentViewErrorDetails) {
        super(message)
        this.name = 'AgentViewError'
        this.statusCode = statusCode
        this.details = details
    }

    toString() {
        return `AgentViewError: ${this.message} (status: ${this.statusCode})${this.details ? `, details: ${JSON.stringify(this.details)}` : ''}`;
    }
}

export type AgentViewErrorBody = AgentViewErrorDetails & {
    message: string
}


export function unwrapError(error: Error | undefined): Error | AgentViewErrorBody | undefined {
    if (!error) {
        return;
    }

    try {
        const json = JSON.parse(error.message);

        // const { message, code, ...rest } = json;

        if (json.source === 'agentview') {
            return json
        }

    } catch (e) {}
    
    return error;
}