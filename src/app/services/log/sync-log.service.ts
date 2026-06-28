import { log } from '../../../utils/log'
import { appendEvent } from '../../domain/sync-log'
import type { SyncLogEvent, SyncLogStatus } from '../../domain/sync-log'

/**
 * In-plugin event bus + capped in-memory buffer for sync/OCR activity. The
 * pipeline and sync commands `emit()` to it; the sidebar view subscribes for
 * live updates. Each event is also mirrored to the dev console via `log()`.
 *
 * No persistent log DB — events live only for the session (capped at
 * MAX_SYNC_LOG_EVENTS, enforced by appendEvent).
 */
export interface SyncLogService {
    emit(status: SyncLogStatus, message: string): void
    getEvents(): readonly SyncLogEvent[]
    clear(): void
    /** Subscribe to changes (emit/clear). Returns an unsubscribe function. */
    subscribe(listener: () => void): () => void
}

function statusToLogLevel(status: SyncLogStatus): 'debug' | 'info' | 'error' {
    switch (status) {
        case 'error':
            return 'error'
        case 'skip':
            return 'debug'
        case 'success':
        case 'info':
            return 'info'
    }
}

export function createSyncLogService(now: () => number = () => Date.now()): SyncLogService {
    let events: SyncLogEvent[] = []
    const listeners = new Set<() => void>()

    function notify(): void {
        for (const listener of listeners) {
            listener()
        }
    }

    function emit(status: SyncLogStatus, message: string): void {
        events = appendEvent(events, { time: now(), status, message })
        // Mirror to the dev console so the existing debugging workflow still works.
        log(message, statusToLogLevel(status))
        notify()
    }

    function getEvents(): readonly SyncLogEvent[] {
        // Return a snapshot copy so callers can't mutate the internal buffer
        // (events themselves are immutable).
        return [...events]
    }

    function clear(): void {
        events = []
        notify()
    }

    function subscribe(listener: () => void): () => void {
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    }

    return { emit, getEvents, clear, subscribe }
}
