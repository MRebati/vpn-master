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

export type StockConfigFormat = 'openvpn' | 'v2ray';

export interface ParsedBulkStockRow {
    username: string | null;
    password: string | null;
    configText: string | null;
    configFormat: StockConfigFormat | null;
}

const USERNAME_HEADERS = new Set([
    'user',
    'username',
    'login',
    'uname',
    'uid',
    'نام کاربری',
    'یوزر',
]);
const PASSWORD_HEADERS = new Set([
    'pass',
    'password',
    'pwd',
    'رمز',
    'رمز عبور',
]);
const CONFIG_HEADERS = new Set([
    'config',
    'configuration',
    'link',
    'url',
    'uri',
    'subscription',
    'sub',
    'v2ray',
    'vmess',
    'vless',
    'trojan',
    'ss',
    'کانفیگ',
    'لینک',
]);
const FORMAT_HEADERS = new Set(['format', 'type', 'kind', 'proto', 'protocol', 'فرمت', 'نوع']);

function normalizeHeader(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes && ch === delimiter) {
            cells.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    cells.push(current.trim());
    return cells;
}

function pickDelimiter(firstLine: string): string | null {
    const candidates = [',', ';', '\t', '|'];
    let winner: string | null = null;
    let maxCount = 0;
    for (const candidate of candidates) {
        const count = firstLine.split(candidate).length - 1;
        if (count > maxCount) {
            maxCount = count;
            winner = candidate;
        }
    }
    return maxCount > 0 ? winner : null;
}

export function inferConfigFormat(value: string | null | undefined): StockConfigFormat | null {
    const text = (value ?? '').trim().toLowerCase();
    if (!text) return null;
    if (
        text.startsWith('vmess://') ||
        text.startsWith('vless://') ||
        text.startsWith('trojan://') ||
        text.startsWith('ss://') ||
        text.startsWith('ssr://') ||
        text.startsWith('hysteria://') ||
        text.startsWith('hy2://') ||
        text.startsWith('tuic://')
    ) {
        return 'v2ray';
    }
    if (text.includes('[interface]') || text.includes('[peer]')) {
        return 'openvpn';
    }
    if (text.includes('client') && text.includes('remote')) {
        return 'openvpn';
    }
    return null;
}

function parseExplicitFormat(value: string | null | undefined): StockConfigFormat | null {
    const normalized = (value ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'v2ray') return 'v2ray';
    if (normalized === 'openvpn' || normalized === 'ovpn') return 'openvpn';
    return null;
}

/**
 * Parse supplier-delivered bulk stock content (CSV/TSV/TXT).
 * Supports:
 * - Header-based rows (username/password/config/format in any order)
 * - Positional rows (username,password,config)
 * - Single-column rows containing V2Ray links (credentials embedded in URL)
 */
export function parseBulkStockRows(text: string): ParsedBulkStockRow[] {
    const normalized = text.replace(/\uFEFF/g, '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const lines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
    if (!lines.length) return [];

    const delimiter = pickDelimiter(lines[0]);
    if (!delimiter) {
        return lines
            .map((line) => {
                const configFormat = inferConfigFormat(line);
                return {
                    username: null,
                    password: null,
                    configText: line || null,
                    configFormat,
                };
            })
            .filter((row) => Boolean(row.configText));
    }

    const rows = lines.map((line) => splitDelimitedLine(line, delimiter));
    const firstRow = rows[0].map(normalizeHeader);
    const headerIndexes = {
        username: firstRow.findIndex((cell) => USERNAME_HEADERS.has(cell)),
        password: firstRow.findIndex((cell) => PASSWORD_HEADERS.has(cell)),
        config: firstRow.findIndex((cell) => CONFIG_HEADERS.has(cell)),
        format: firstRow.findIndex((cell) => FORMAT_HEADERS.has(cell)),
    };
    const hasHeader =
        headerIndexes.username >= 0 ||
        headerIndexes.password >= 0 ||
        headerIndexes.config >= 0 ||
        headerIndexes.format >= 0;

    const dataRows = hasHeader ? rows.slice(1) : rows;
    return dataRows
        .map((row) => {
            const username = hasHeader
                ? (headerIndexes.username >= 0 ? row[headerIndexes.username]?.trim() ?? '' : '')
                : row[0]?.trim() ?? '';
            const password = hasHeader
                ? (headerIndexes.password >= 0 ? row[headerIndexes.password]?.trim() ?? '' : '')
                : row[1]?.trim() ?? '';
            const configText = hasHeader
                ? (headerIndexes.config >= 0 ? row[headerIndexes.config]?.trim() ?? '' : '')
                : row[2]?.trim() ?? '';
            const rawFormat = hasHeader
                ? (headerIndexes.format >= 0 ? row[headerIndexes.format]?.trim() ?? '' : '')
                : row[3]?.trim() ?? '';

            const effectiveConfigText =
                configText || (username && !password && inferConfigFormat(username) ? username : '');
            const explicitFormat = parseExplicitFormat(rawFormat);
            const inferredFormat = inferConfigFormat(effectiveConfigText);
            return {
                username: username || null,
                password: password || null,
                configText: effectiveConfigText || null,
                configFormat: explicitFormat ?? inferredFormat,
            };
        })
        .filter(
            (row) =>
                Boolean(row.username && row.password) ||
                Boolean(row.configText && row.configText.length > 0)
        );
}
