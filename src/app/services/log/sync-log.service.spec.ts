import { test, expect, describe } from 'bun:test'
import { createSyncLogService } from './sync-log.service'
import { MAX_SYNC_LOG_EVENTS } from '../../domain/sync-log'

describe('createSyncLogService', () => {
    test('emit records events with status, message, and a timestamp', () => {
        let clock = 1000
        const svc = createSyncLogService(() => clock)
        svc.emit('success', 'page transcribed')
        clock = 2000
        svc.emit('error', 'OCR failed — HTTP 429')

        const events = svc.getEvents()
        expect(events).toHaveLength(2)
        expect(events[0]).toEqual({ time: 1000, status: 'success', message: 'page transcribed' })
        expect(events[1]).toEqual({ time: 2000, status: 'error', message: 'OCR failed — HTTP 429' })
    })

    test('caps the in-memory buffer', () => {
        const svc = createSyncLogService(() => 0)
        for (let i = 0; i < MAX_SYNC_LOG_EVENTS + 10; i++) {
            svc.emit('info', `e${i}`)
        }
        expect(svc.getEvents()).toHaveLength(MAX_SYNC_LOG_EVENTS)
        expect(svc.getEvents()[0]!.message).toBe('e10')
    })

    test('clear empties the buffer', () => {
        const svc = createSyncLogService(() => 0)
        svc.emit('info', 'x')
        svc.clear()
        expect(svc.getEvents()).toHaveLength(0)
    })

    test('subscribers are notified on emit and clear; unsubscribe stops them', () => {
        const svc = createSyncLogService(() => 0)
        let calls = 0
        const unsubscribe = svc.subscribe(() => {
            calls++
        })
        svc.emit('info', 'a') // 1
        svc.clear() // 2
        unsubscribe()
        svc.emit('info', 'b') // not counted
        expect(calls).toBe(2)
    })

    test('getEvents reflects the latest snapshot (no stale reference)', () => {
        const svc = createSyncLogService(() => 0)
        const before = svc.getEvents()
        svc.emit('info', 'a')
        expect(before).toHaveLength(0) // earlier snapshot unchanged
        expect(svc.getEvents()).toHaveLength(1)
    })
})
