/**
 * Escape text for Telegram HTML parse_mode (dynamic user content).
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Telegram Bot API HTML mode — use with parse_mode. */
export const PARSE_HTML = 'HTML' as const;
