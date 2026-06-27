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
    syncStore: DEFAULT_SYNC_STORE
}
