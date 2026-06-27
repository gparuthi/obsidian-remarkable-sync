/**
 * Sync state tracked per notebook
 */
export interface NotebookSyncState {
    readonly remarkableId: string
    readonly lastSyncedAt: number // epoch ms, 0 = never synced
    readonly lastModifiedCloud: number // epoch ms from cloud
    readonly syncedPageCount: number
}

/**
 * Persistent store for all notebook sync states
 */
export interface SyncStore {
    readonly notebooks: Record<string, NotebookSyncState> // keyed by remarkableId
}

/**
 * Derived sync status for UI display
 */
export type SyncStatus = 'synced' | 'needs-sync' | 'never-synced'

/**
 * Derive the sync status from a notebook's sync state
 */
export function deriveSyncStatus(state: NotebookSyncState | undefined): SyncStatus {
    if (!state || state.lastSyncedAt === 0) {
        return 'never-synced'
    }
    if (state.lastSyncedAt >= state.lastModifiedCloud) {
        return 'synced'
    }
    return 'needs-sync'
}

/**
 * Decide whether a notebook needs syncing during an all-notebook sync.
 *
 * Compares the cloud's current `lastModified` (epoch ms, as the string the cloud
 * listing returns) against the `lastModifiedCloud` we persisted on the last
 * successful sync. A notebook whose cloud mtime has not advanced is skipped so we
 * do not re-download/re-render unchanged notebooks. Never-synced notebooks, and
 * notebooks whose cloud mtime cannot be parsed, sync (fail toward syncing).
 */
export function notebookNeedsSync(
    currentLastModified: string,
    state: NotebookSyncState | undefined
): boolean {
    if (!state || state.lastSyncedAt === 0) {
        return true // never synced
    }
    const currentMod = parseInt(currentLastModified, 10)
    if (!Number.isFinite(currentMod) || currentMod === 0) {
        return true // unparseable cloud mtime → sync to be safe
    }
    return currentMod > state.lastModifiedCloud
}

export const DEFAULT_SYNC_STORE: SyncStore = {
    notebooks: {}
}
