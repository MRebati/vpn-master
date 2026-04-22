import type { Context } from 'grammy';
import type { Env } from '../index';

/**
 * Staff by Telegram user id only (for inline_query / chosen_inline_result — no chat).
 */
export function isStaffUserId(userId: number | undefined, env: Env): boolean {
    if (userId === undefined) return false;
    if (String(userId) === env.ADMIN_USER_ID) return true;
    const list =
        env.STAFF_USER_IDS?.split(',')
            .map((x) => x.trim())
            .filter(Boolean) ?? [];
    return list.includes(String(userId));
}

/**
 * Compare Telegram chat id to env value (with or without -100 prefix).
 */
export function chatMatchesConfiguredChannel(
    chatId: number | undefined,
    rawChannelId: string | undefined
): boolean {
    if (chatId === undefined || !rawChannelId?.trim()) return false;
    const idStr = String(chatId);
    const s = rawChannelId.trim();
    if (s.startsWith('-')) return idStr === s;
    return idStr === `-100${s}` || idStr === s;
}

/** Numeric channel id from env (no -100) or full chat id string — returns API chat id for supergroups/channels. */
export function resolveTelegramChannelChatId(raw: string | undefined): string | null {
    const s = raw?.trim();
    if (!s) return null;
    if (s.startsWith('-')) return s;
    return `-100${s}`;
}

/** Unique staff / CRM / stock / payment channel ids (deduped). */
function staffLikeChannelIds(env: Env): string[] {
    const ids = [env.STAFF_CHANNEL_ID, env.STOCK_CHANNEL_ID, env.CHANNEL_ID]
        .map((x) => x?.trim())
        .filter((x): x is string => Boolean(x));
    return [...new Set(ids)];
}

/**
 * Staff may:
 * - be ADMIN_USER_ID
 * - appear in STAFF_USER_IDS
 * - send a message or press an inline button *in* the chat matching STAFF_CHANNEL_ID,
 *   STOCK_CHANNEL_ID, or CHANNEL_ID (same channel_id for CRM + admin is supported).
 */
export function canActAsStaff(ctx: Context, env: Env): boolean {
    const uid = ctx.from?.id;
    if (uid === undefined) return false;

    if (uid.toString() === env.ADMIN_USER_ID) return true;

    const list =
        env.STAFF_USER_IDS?.split(',')
            .map((x) => x.trim())
            .filter(Boolean) ?? [];
    if (list.includes(uid.toString())) return true;

    const chatId =
        ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    for (const raw of staffLikeChannelIds(env)) {
        if (chatMatchesConfiguredChannel(chatId, raw)) return true;
    }

    return false;
}

/** Chats where raw User/Pass blocks are ingested (stock + staff; not payment CRM alone). */
function stockIngestChannelIds(env: Env): string[] {
    const ids = [env.STOCK_CHANNEL_ID, env.STAFF_CHANNEL_ID]
        .map((x) => x?.trim())
        .filter((x): x is string => Boolean(x));
    return [...new Set(ids)];
}

/** True in stock/staff supergroups/channels (or private chat with staff — for testing). */
export function isStockIngestChat(ctx: Context, env: Env): boolean {
    if (ctx.chat?.type === 'private') return false;
    const chatId = ctx.chat?.id;
    for (const raw of stockIngestChannelIds(env)) {
        if (chatMatchesConfiguredChannel(chatId, raw)) return true;
    }
    return false;
}

/** Staff may paste credentials in stock/staff channel or in DM. */
export function canUseStockPaste(ctx: Context, env: Env): boolean {
    if (!canActAsStaff(ctx, env)) return false;
    if (ctx.chat?.type === 'private') return true;
    return isStockIngestChat(ctx, env);
}
