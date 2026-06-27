import { test, expect, describe } from 'bun:test'
import { deriveSyncStatus, notebookNeedsSync, DEFAULT_SYNC_STORE } from './sync-state'
import type { NotebookSyncState } from './sync-state'

describe('deriveSyncStatus', () => {
    test('returns never-synced when state is undefined', () => {
        expect(deriveSyncStatus(undefined)).toBe('never-synced')
    })

    test('returns never-synced when lastSyncedAt is 0', () => {
        const state: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 0,
            lastModifiedCloud: 1000,
            syncedPageCount: 0
        }
        expect(deriveSyncStatus(state)).toBe('never-synced')
    })

    test('returns synced when lastSyncedAt >= lastModifiedCloud', () => {
        const state: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 2000,
            lastModifiedCloud: 1000,
            syncedPageCount: 5
        }
        expect(deriveSyncStatus(state)).toBe('synced')
    })

    test('returns synced when lastSyncedAt equals lastModifiedCloud', () => {
        const state: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 1000,
            lastModifiedCloud: 1000,
            syncedPageCount: 5
        }
        expect(deriveSyncStatus(state)).toBe('synced')
    })

    test('returns needs-sync when lastSyncedAt < lastModifiedCloud', () => {
        const state: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 500,
            lastModifiedCloud: 1000,
            syncedPageCount: 5
        }
        expect(deriveSyncStatus(state)).toBe('needs-sync')
    })
})

describe('DEFAULT_SYNC_STORE', () => {
    test('has empty notebooks record', () => {
        expect(DEFAULT_SYNC_STORE.notebooks).toEqual({})
    })
})

describe('notebookNeedsSync', () => {
    test('syncs when state is undefined (never synced)', () => {
        expect(notebookNeedsSync('1000', undefined)).toBe(true)
    })

    test('syncs when lastSyncedAt is 0 (never synced)', () => {
        const state: NotebookSyncState = {
            remarkableId: 'id',
            lastSyncedAt: 0,
            lastModifiedCloud: 1000,
            syncedPageCount: 0
        }
        expect(notebookNeedsSync('1000', state)).toBe(true)
    })

    test('skips when cloud mtime has not advanced past last synced', () => {
        const state: NotebookSyncState = {
            remarkableId: 'id',
            lastSyncedAt: 5000,
            lastModifiedCloud: 1000,
            syncedPageCount: 3
        }
        expect(notebookNeedsSync('1000', state)).toBe(false)
    })

    test('syncs when cloud mtime is newer than last synced', () => {
        const state: NotebookSyncState = {
            remarkableId: 'id',
            lastSyncedAt: 5000,
            lastModifiedCloud: 1000,
            syncedPageCount: 3
        }
        expect(notebookNeedsSync('2000', state)).toBe(true)
    })

    test('syncs when cloud mtime is unparseable', () => {
        const state: NotebookSyncState = {
            remarkableId: 'id',
            lastSyncedAt: 5000,
            lastModifiedCloud: 1000,
            syncedPageCount: 3
        }
        expect(notebookNeedsSync('not-a-number', state)).toBe(true)
    })

    test('syncs when cloud mtime parses to 0', () => {
        const state: NotebookSyncState = {
            remarkableId: 'id',
            lastSyncedAt: 5000,
            lastModifiedCloud: 1000,
            syncedPageCount: 3
        }
        expect(notebookNeedsSync('0', state)).toBe(true)
    })
})
