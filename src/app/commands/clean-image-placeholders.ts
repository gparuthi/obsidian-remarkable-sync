import { Notice } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import {
    cleanImagePlaceholders,
    describeCleanResult
} from '../services/migration/clean-image-placeholders'
import { log } from '../../utils/log'

/**
 * Manual command: rewrite broken `img-N` OCR placeholders in all assembled notes to
 * embed each page's real saved image, reconciling stored hashes. Safe to re-run.
 */
export async function cleanImagePlaceholdersCommand(plugin: RemarkableSyncPlugin): Promise<void> {
    try {
        const result = await cleanImagePlaceholders(plugin)
        const message = describeCleanResult(result)
        new Notice(message)
        plugin.syncLogService.emit(result.blocksCleaned > 0 ? 'success' : 'info', message)
    } catch (error) {
        log('Clean image placeholders failed', 'error', error)
        new Notice('Failed to clean image placeholders — see console')
    }
}
