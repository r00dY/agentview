export type RunTerminationReason = { status: 'cancelled' } | { status: 'failed', reason: any } | { status: 'discarded', reason: any };

export function terminationReasonText(body: RunTerminationReason) {
  switch (body.status) {
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return `failed${body.reason ? ` (${body.reason.message})` : ''}`;
    case 'discarded':
      return `discarded${body.reason ? ` (${body.reason.message})` : ''}`;
  }
}

export class RunTerminationError extends Error {
  constructor(public reason: RunTerminationReason) {
    super(terminationReasonText(reason));
    this.name = 'RunTerminationError';
  }
}


