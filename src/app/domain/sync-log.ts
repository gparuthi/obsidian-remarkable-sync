/**
 * In-app sync-log model (pure). The service layer adds the event bus + console
 * mirroring; the view renders these. Kept dependency-free so the buffer cap and
 * formatting are unit-testable.
 */

export type SyncLogStatus = 'info' | 'success' | 'skip' | 'error'

export interface SyncLogEvent {
    /** Epoch ms when the event was emitted. */
    readonly time: number
    readonly status: SyncLogStatus
    readonly message: string
}

/** Most events we keep in memory; older ones are dropped (no persistent DB). */
export const MAX_SYNC_LOG_EVENTS = 200

/**
 * Append an event to the log, returning a new array capped to the last `cap`
 * events (oldest dropped first). Pure — never mutates the input.
 */
export function appendEvent(
    events: readonly SyncLogEvent[],
    event: SyncLogEvent,
    cap: number = MAX_SYNC_LOG_EVENTS
): SyncLogEvent[] {
    const next = [...events, event]
    return next.length > cap ? next.slice(next.length - cap) : next
}

/** Marker glyph for a status (used by the view and console mirror). */
export function statusMarker(status: SyncLogStatus): string {
    switch (status) {
        case 'success':
            return '✓'
        case 'skip':
            return '⊘'
        case 'error':
            return '✗'
        case 'info':
            return '•'
    }
}

/** Zero-padded `HH:MM:SS` clock for an event time (local time). */
export function formatClock(time: number): string {
    const d = new Date(time)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** One-line rendering of an event: `HH:MM:SS <marker> <message>`. */
export function formatEvent(event: SyncLogEvent): string {
    return `${formatClock(event.time)} ${statusMarker(event.status)} ${event.message}`
}
