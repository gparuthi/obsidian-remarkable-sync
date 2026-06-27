import { Setting, debounce } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'
import { MIN_AUTO_SYNC_INTERVAL_MINUTES } from '../../types/plugin-settings.intf'

export function renderSyncSection(containerEl: HTMLElement, plugin: RemarkableSyncPlugin): void {
    new Setting(containerEl).setName('Automatic sync').setHeading()

    new Setting(containerEl)
        .setName('Sync on startup')
        .setDesc('Sync all notebooks once when Obsidian starts.')
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.syncOnStartup).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.syncOnStartup = value
                })
            })
        })

    new Setting(containerEl)
        .setName('Periodic auto-sync')
        .setDesc('Periodically sync all notebooks while Obsidian is open.')
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.autoSync).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.autoSync = value
                })
                plugin.setupAutoSync()
            })
        })

    new Setting(containerEl)
        .setName('Auto-sync interval (minutes)')
        .setDesc(`How often to auto-sync. Minimum ${MIN_AUTO_SYNC_INTERVAL_MINUTES} minutes.`)
        .addText((text) => {
            const saveInterval = debounce(
                async (value: string) => {
                    const parsed = parseInt(value, 10)
                    if (!Number.isFinite(parsed)) {
                        return
                    }
                    const minutes = Math.max(MIN_AUTO_SYNC_INTERVAL_MINUTES, parsed)
                    await plugin.updateSettings((draft) => {
                        draft.autoSyncIntervalMinutes = minutes
                    })
                    plugin.setupAutoSync()
                },
                500,
                true
            )

            text.setPlaceholder('15')
                .setValue(String(plugin.settings.autoSyncIntervalMinutes))
                .onChange(saveInterval)
        })
}
