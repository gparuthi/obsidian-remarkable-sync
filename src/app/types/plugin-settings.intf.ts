import type { SyncStore } from '../domain/sync-state'
import { DEFAULT_SYNC_STORE } from '../domain/sync-state'

export const MIN_AUTO_SYNC_INTERVAL_MINUTES = 5

export interface PluginSettings {
    targetFolder: string
    saveImages: boolean
    imageFormat: 'png' | 'jpeg' | 'webp'
    imageQuality: number
    useRmfakecloud: boolean
    rmfakecloudUrl: string
    syncOnStartup: boolean
    autoSync: boolean
    autoSyncIntervalMinutes: number
    sourceFolder: string
    autoSyncNewestOnly: boolean
    /** Transcribe each synced page to markdown via the local OCR endpoint. */
    ocrEnabled: boolean
    /** URL of the local md_capture_server `/ocr` endpoint (image in → markdown out). */
    mdserverOcrUrl: string
    /** Delay (ms) between per-page OCR requests, to stay under the provider's rate limit. */
    ocrRequestDelayMs: number
    /**
     * Internal: set once the one-time `img-N` placeholder → real-page-image migration
     * has run, so it does not re-scan on every load.
     */
    imgPlaceholderMigrationDone: boolean
    syncStore: SyncStore
}

export const DEFAULT_SETTINGS: PluginSettings = {
    targetFolder: '',
    saveImages: true,
    imageFormat: 'jpeg',
    imageQuality: 0.85,
    useRmfakecloud: false,
    rmfakecloudUrl: '',
    syncOnStartup: false,
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    sourceFolder: '/2026',
    autoSyncNewestOnly: true,
    ocrEnabled: false,
    mdserverOcrUrl: 'http://localhost:1250/ocr',
    ocrRequestDelayMs: 400,
    imgPlaceholderMigrationDone: false,
    syncStore: DEFAULT_SYNC_STORE
}
