import { test, expect, describe } from 'bun:test'
import {
    appendEvent,
    formatClock,
    formatEvent,
    statusMarker,
    MAX_SYNC_LOG_EVENTS
} from './sync-log'
import type { SyncLogEvent } from './sync-log'

function ev(message: string, time = 0): SyncLogEvent {
    return { time, status: 'info', message }
}

describe('appendEvent', () => {
    test('appends to the end without mutating the input', () => {
        const a: SyncLogEvent[] = [ev('a')]
        const out = appendEvent(a, ev('b'))
        expect(out.map((e) => e.message)).toEqual(['a', 'b'])
        expect(a).toHaveLength(1) // input untouched
    })

    test('caps to the last N events (oldest dropped first)', () => {
        let events: SyncLogEvent[] = []
        for (let i = 0; i < 10; i++) {
            events = appendEvent(events, ev(`e${i}`), 5)
        }
        expect(events).toHaveLength(5)
        expect(events.map((e) => e.message)).toEqual(['e5', 'e6', 'e7', 'e8', 'e9'])
    })

    test('defaults to MAX_SYNC_LOG_EVENTS', () => {
        let events: SyncLogEvent[] = []
        for (let i = 0; i < MAX_SYNC_LOG_EVENTS + 25; i++) {
            events = appendEvent(events, ev(`e${i}`))
        }
        expect(events).toHaveLength(MAX_SYNC_LOG_EVENTS)
        expect(events[0]!.message).toBe('e25') // first 25 dropped
        expect(events[events.length - 1]!.message).toBe(`e${MAX_SYNC_LOG_EVENTS + 24}`)
    })
})

describe('statusMarker', () => {
    test('maps each status to a distinct glyph', () => {
        expect(statusMarker('success')).toBe('✓')
        expect(statusMarker('skip')).toBe('⊘')
        expect(statusMarker('error')).toBe('✗')
        expect(statusMarker('info')).toBe('•')
    })
})

describe('formatClock', () => {
    test('zero-pads HH:MM:SS', () => {
        // 01:02:03 local time on the given date
        const t = new Date(2026, 0, 1, 1, 2, 3).getTime()
        expect(formatClock(t)).toBe('01:02:03')
    })
})

describe('formatEvent', () => {
    test('includes the marker and the message', () => {
        const line = formatEvent({ time: 0, status: 'error', message: 'OCR failed — HTTP 429' })
        expect(line).toContain('✗')
        expect(line).toContain('OCR failed — HTTP 429')
    })
})
