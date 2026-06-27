import { Notice } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { notebookNeedsSync } from '../domain/sync-state'
import { notebooksInFolder, newestNotebook } from '../domain/notebook'
import { log } from '../../utils/log'

export interface SyncAllResult {
    total: number
    synced: number
    skipped: number
    failed: number
}

export interface SyncAllOptions {
    /** Suppress this routine's own start/no-op notices (for unattended runs). */
    silent?: boolean
    /**
     * Restrict to notebooks within this cloud folder (recursive). Empty/undefined
     * = all folders. Used to scope auto-sync to e.g. `/2026`.
     */
    folder?: string
    /**
     * Sync only the single most-recently-modified notebook in scope (after the
     * folder filter). Still skipped if unchanged.
     */
    newestOnly?: boolean
}

/**
 * Sync notebooks from the reMarkable cloud, reusing the existing per-notebook
 * pipeline. Optionally scoped to a `folder` and/or to the single `newestOnly`
 * notebook. Unchanged notebooks (cloud mtime not advanced past the last sync)
 * are skipped so we do not re-render anything that has not changed.
 *
 * Fail-soft: a single bad notebook (download/parse/render error) is logged and
 * counted, never thrown — one failure must not abort the run, crash Obsidian, or
 * wedge the periodic loop. Pass `silent: true` for unattended (startup/interval)
 * runs to suppress the routine's own start/no-op notices; per-notebook notices
 * from the pipeline and the final summary on activity/failure still surface.
 */
export async function syncAllNotebooks(
    plugin: RemarkableSyncPlugin,
    options: SyncAllOptions = {}
): Promise<SyncAllResult> {
    const result: SyncAllResult = { total: 0, synced: 0, skipped: 0, failed: 0 }
    const silent = options.silent === true

    if (!plugin.isConnected) {
        if (!silent) {
            new Notice('Not connected to reMarkable cloud')
        }
        return result
    }

    // Prevent overlapping runs (startup + interval, manual + interval, or a slow
    // run still going when the next tick fires).
    if (plugin.isSyncing) {
        log('Sync all skipped: a sync is already running', 'debug')
        if (!silent) {
            new Notice('A reMarkable sync is already in progress')
        }
        return result
    }
    plugin.isSyncing = true

    try {
        let notebooks
        try {
            notebooks = await plugin.cloudService.listDocuments()
        } catch (error) {
            log('Sync all: failed to list notebooks', 'error', error)
            if (!silent) {
                new Notice('Failed to fetch notebook list')
            }
            return result
        }

        if (notebooks.length === 0) {
            if (!silent) {
                new Notice('No notebooks found')
            }
            return result
        }

        // Scope: restrict to the source folder, then optionally to the single
        // newest-modified notebook. This is what keeps auto-sync from touching
        // other folders (e.g. /Books) or re-rendering everything.
        let candidates =
            options.folder !== undefined ? notebooksInFolder(notebooks, options.folder) : notebooks
        if (options.newestOnly) {
            const newest = newestNotebook(candidates)
            candidates = newest ? [newest] : []
        }

        result.total = candidates.length
        if (candidates.length === 0) {
            if (!silent) {
                const where = options.folder ? ` in "${options.folder}"` : ''
                new Notice(`No notebooks to sync${where}`)
            }
            return result
        }

        if (!silent) {
            const label = options.newestOnly
                ? `Syncing newest notebook (${candidates[0]!.visibleName})...`
                : `Syncing ${candidates.length} notebooks...`
            new Notice(label)
        }

        for (const notebook of candidates) {
            const state = plugin.syncStoreService.getState(notebook.id)
            if (!notebookNeedsSync(notebook.lastModified, state)) {
                result.skipped++
                continue
            }

            try {
                const ok = await plugin.pipelineService.processNotebook(notebook, (progress) => {
                    if (progress.status === 'error') {
                        log(
                            `Sync all: ${notebook.visibleName} reported ${progress.error ?? 'an error'}`,
                            'debug'
                        )
                    }
                })
                if (ok) {
                    result.synced++
                } else {
                    result.failed++
                }
            } catch (error) {
                // Fail-soft: keep going through the rest of the notebooks.
                result.failed++
                log(`Sync all: error syncing ${notebook.visibleName}`, 'error', error)
            }
        }

        const summary = `reMarkable sync: ${result.synced} synced, ${result.skipped} unchanged, ${result.failed} failed`
        log(summary, 'info', result)
        // Always surface a summary on a manual run; for unattended runs, surface
        // only when something actually happened (synced or failed) so a quiet
        // "nothing changed" tick stays quiet.
        if (!silent || result.synced > 0 || result.failed > 0) {
            new Notice(summary)
        }
        return result
    } finally {
        plugin.isSyncing = false
    }
}
