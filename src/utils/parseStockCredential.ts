/**
 * Parse staff paste blocks like:
 * User
 * V130
 *
 * Pass
 * 474669
 */
export function parseUserPassBlock(text: string): { username: string; password: string } | null {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return null;

    const block = /^user\s*\n+\s*([\s\S]+?)\s*\n+\s*pass\s*\n+\s*([\s\S]+)$/i;
    let m = normalized.match(block);
    if (m) {
        const u = m[1].trim();
        const p = m[2].trim();
        if (u && p) return { username: u, password: p };
    }

    const inline =
        /(?:^|\n)\s*user\s*[:\：]?\s*([^\n]+?)\s*(?:\n|$)[\s\S]*?pass\s*[:\：]?\s*([^\n]+?)\s*$/is;
    m = normalized.match(inline);
    if (m) {
        const u = m[1].trim();
        const p = m[2].trim();
        if (u && p) return { username: u, password: p };
    }

    return null;
}
