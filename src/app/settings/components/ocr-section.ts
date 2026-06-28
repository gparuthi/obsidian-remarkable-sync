import { Setting, debounce } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'

export function renderOcrSection(containerEl: HTMLElement, plugin: RemarkableSyncPlugin): void {
    new Setting(containerEl).setName('OCR transcription').setHeading()

    new Setting(containerEl)
        .setName('Transcribe pages to markdown')
        .setDesc(
            'After syncing, send each new or changed page image to the local OCR server and assemble one markdown note per notebook (newest page on top). Requires the local md_capture_server to be running.'
        )
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.ocrEnabled).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.ocrEnabled = value
                })
            })
        })

    new Setting(containerEl)
        .setName('OCR server URL')
        .setDesc(
            'Endpoint of the local OCR server. The page image is posted here; nothing is sent to any other destination.'
        )
        .addText((text) => {
            const saveUrl = debounce(
                async (value: string) => {
                    await plugin.updateSettings((draft) => {
                        draft.mdserverOcrUrl = value.trim()
                    })
                },
                500,
                true
            )

            text.setPlaceholder('http://localhost:1250/ocr')
                .setValue(plugin.settings.mdserverOcrUrl)
                .onChange(saveUrl)
        })

    new Setting(containerEl)
        .setName('OCR request delay (ms)')
        .setDesc(
            'Pause between per-page OCR requests to stay under the OCR provider rate limit. Pages are OCR’d one at a time; rate-limited pages are retried with backoff. 0 disables the delay.'
        )
        .addText((text) => {
            const saveDelay = debounce(
                async (value: string) => {
                    const parsed = parseInt(value, 10)
                    if (!Number.isFinite(parsed) || parsed < 0) {
                        return
                    }
                    await plugin.updateSettings((draft) => {
                        draft.ocrRequestDelayMs = parsed
                    })
                },
                500,
                true
            )

            text.setPlaceholder('400')
                .setValue(String(plugin.settings.ocrRequestDelayMs))
                .onChange(saveDelay)
        })
}
