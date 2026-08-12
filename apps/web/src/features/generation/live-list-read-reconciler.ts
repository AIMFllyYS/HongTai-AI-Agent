export interface LiveListReadToken {
  readonly requestId: number;
  readonly eventCursor: number;
}

interface RecordedListChange<TEvent> {
  readonly eventCursor: number;
  readonly event: TEvent;
}

/** Replays persisted live changes that arrive while the latest list read is in flight. */
export class LiveListReadReconciler<TEvent> {
  private requestSequence = 0;
  private eventSequence = 0;
  private activeRead?: LiveListReadToken;
  private recordedChanges: RecordedListChange<TEvent>[] = [];

  beginRead(): LiveListReadToken {
    const token = {
      requestId: this.requestSequence + 1,
      eventCursor: this.eventSequence,
    };
    this.requestSequence = token.requestId;
    this.activeRead = token;
    this.recordedChanges = [];
    return token;
  }

  record(event: TEvent): void {
    this.eventSequence += 1;
    if (!this.activeRead) return;
    this.recordedChanges.push({ eventCursor: this.eventSequence, event });
  }

  reconcile<TValue>(
    token: LiveListReadToken,
    loaded: TValue,
    applyChange: (current: TValue, event: TEvent) => TValue,
  ): TValue | undefined {
    if (!this.isActive(token)) return undefined;
    let reconciled = loaded;
    for (const change of this.recordedChanges) {
      if (change.eventCursor > token.eventCursor) {
        reconciled = applyChange(reconciled, change.event);
      }
    }
    this.activeRead = undefined;
    this.recordedChanges = [];
    return reconciled;
  }

  abandon(token: LiveListReadToken): boolean {
    if (!this.isActive(token)) return false;
    this.activeRead = undefined;
    this.recordedChanges = [];
    return true;
  }

  private isActive(token: LiveListReadToken): boolean {
    return this.activeRead?.requestId === token.requestId
      && this.activeRead.eventCursor === token.eventCursor;
  }
}
