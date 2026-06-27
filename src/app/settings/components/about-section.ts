import { Setting } from 'obsidian'

/**
 * About section for the settings tab.
 *
 * This is a hardened, self-built fork of the upstream "Remarkable Synchronizer"
 * plugin by Sébastien Dubois (MIT). The original funding/social nags and their
 * external links (x.com, buymeacoffee.com) have been removed. The plugin makes
 * no network calls other than to the reMarkable cloud (or a user-configured
 * rmfakecloud server) and ships no telemetry.
 */
export function renderAboutSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('About').setHeading()

    new Setting(containerEl)
        .setName('Hardened fork')
        .setDesc(
            'Self-built, dependency-pinned fork of the open-source "Remarkable Synchronizer" plugin by Sébastien Dubois (MIT). No telemetry; connects only to the reMarkable cloud or your configured rmfakecloud server.'
        )
}
