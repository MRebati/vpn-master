import type { Context } from 'grammy';
import type { Env } from '../index';

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

/**
 * Staff may:
 * - be ADMIN_USER_ID
 * - appear in STAFF_USER_IDS
 * - send a message or press an inline button *in* the chat matching STAFF_CHANNEL_ID
 *   (private staff supergroup: everyone who can post there is treated as staff for that action).
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
    if (chatMatchesConfiguredChannel(chatId, env.STAFF_CHANNEL_ID)) {
        return true;
    }

    return false;
}
