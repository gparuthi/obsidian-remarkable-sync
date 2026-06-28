/**
 * Resolve after `ms` milliseconds. Uses `window.setTimeout` (Obsidian timer
 * convention). Injectable in callers that need a fake clock in tests.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
}
