import { ItemView, setIcon } from 'obsidian'
import type { WorkspaceLeaf } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { formatClock, statusMarker } from '../domain/sync-log'
import type { SyncLogEvent } from '../domain/sync-log'

export const SYNC_LOG_VIEW_TYPE = 'remarkable-sync-log'

/**
 * Sidebar view showing a live, capped log of reMarkable sync + OCR activity —
 * successes, skips, and especially failures with their reason. Subscribes to the
 * plugin's sync-log service and re-renders on each new event.
 */
export class SyncLogView extends ItemView {
    private readonly plugin: RemarkableSyncPlugin
    private unsubscribe: (() => void) | null = null

    constructor(leaf: WorkspaceLeaf, plugin: RemarkableSyncPlugin) {
        super(leaf)
        this.plugin = plugin
    }

    override getViewType(): string {
        return SYNC_LOG_VIEW_TYPE
    }

    override getDisplayText(): string {
        return 'reMarkable sync log'
    }

    override getIcon(): string {
        return 'scroll-text'
    }

    override async onOpen(): Promise<void> {
        // Guard against a double subscribe if onOpen is ever called twice.
        this.unsubscribe?.()
        this.unsubscribe = this.plugin.syncLogService.subscribe(() => this.render())
        this.render()
    }

    override async onClose(): Promise<void> {
        this.unsubscribe?.()
        this.unsubscribe = null
    }

    private render(): void {
        const { contentEl } = this
        contentEl.empty()

        const root = contentEl.createDiv({ cls: 'remarkable-synclog' })
        this.renderHeader(root)

        const events = this.plugin.syncLogService.getEvents()
        if (events.length === 0) {
            root.createDiv({
                cls: 'remarkable-synclog-empty',
                text: 'No sync activity yet. Run a sync to see events here.'
            })
            return
        }

        const list = root.createDiv({ cls: 'remarkable-synclog-list' })
        // Newest first so the latest activity is visible without scrolling.
        for (let i = events.length - 1; i >= 0; i--) {
            this.renderEvent(list, events[i]!)
        }
    }

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'remarkable-synclog-header' })
        header.createEl('h4', { text: 'reMarkable sync log' })

        const actions = header.createDiv({ cls: 'remarkable-synclog-actions' })
        const count = this.plugin.syncLogService.getEvents().length
        actions.createSpan({ cls: 'remarkable-synclog-count', text: `${count} events` })

        const clearBtn = actions.createEl('button', {
            cls: 'remarkable-btn remarkable-btn-icon',
            attr: { 'aria-label': 'Clear sync log' }
        })
        setIcon(clearBtn, 'trash-2')
        clearBtn.addEventListener('click', () => {
            this.plugin.syncLogService.clear()
        })
    }

    private renderEvent(container: HTMLElement, event: SyncLogEvent): void {
        const row = container.createDiv({
            cls: `remarkable-synclog-row remarkable-synclog-${event.status}`
        })
        row.createSpan({ cls: 'remarkable-synclog-time', text: formatClock(event.time) })
        row.createSpan({ cls: 'remarkable-synclog-marker', text: statusMarker(event.status) })
        row.createSpan({ cls: 'remarkable-synclog-msg', text: event.message })
    }
}
