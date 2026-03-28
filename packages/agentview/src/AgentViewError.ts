export interface AgentViewGeneralErrorDetails {
    code?: undefined
    cause?: any
    [key: string]: any
}

export interface AgentViewParseErrorDetails {
    code: "parse.schema"
    issues: any,
}

export type AgentViewRunTerminationBody = 
    { status: 'cancelled' } | 
    { status: 'failed', failReason: any } | 
    { status: 'discarded', failReason: any };

export type AgentViewRunTerminatedErrorDetails = {
    code: "run.finished"
} & AgentViewRunTerminationBody;

export type AgentViewErrorDetails = AgentViewGeneralErrorDetails | AgentViewParseErrorDetails | AgentViewRunTerminatedErrorDetails

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