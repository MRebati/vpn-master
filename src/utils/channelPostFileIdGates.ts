import type { Message } from '@grammyjs/types';

const CHANNEL_MSG_SLOT = 'https://internal/vpn-master/chmsg-fileid/';

/**
 * Payment / crypto notifications the customer bot posts into CHANNEL_ID already include file_id in the caption.
 * Skip auto-reply on those channel_post updates so receipts do not get extra file_id spam.
 */
export function isCrmReceiptLikeChannelPost(post: Message | undefined): boolean {
    if (!post) return false;
    const cap = post.caption ?? '';
    if (cap.includes('رسید پرداخت')) return true;
    if (cap.includes('درخواست بررسی پرداخت رمزارزی')) return true;
    if (cap.includes('payment #') && (cap.includes('تومان') || cap.includes('File ID:'))) return true;
    // Customer bot always prefixes CRM media with this emoji in captions.
    if (cap.includes('🔔') && (cap.includes('پرداخت') || cap.includes('payment #'))) return true;
    const rows = post.reply_markup?.inline_keyboard;
    if (
        rows?.some((row) =>
            row.some(
                (b) =>
                    typeof b.callback_data === 'string' &&
                    (b.callback_data.startsWith('ap:') || b.callback_data.startsWith('rj:'))
            )
        )
    ) {
        return true;
    }
    return false;
}

/**
 * One auto file_id reply per channel message (chat_id + message_id).
 * - Stops duplicate replies when Telegram retries the webhook with a new update_id.
 * - Stops double replies when both the customer bot and admin bot receive the same channel_post (same message_id).
 *
 * Cache API is best-effort; if unavailable (e.g. tests), every delivery is processed.
 */
export async function claimChannelPostMessageFileIdSlot(
    chatId: number | undefined,
    messageId: number | undefined
): Promise<boolean> {
    if (chatId === undefined || messageId === undefined) return true;
    const cache = typeof caches !== 'undefined' ? caches.default : undefined;
    if (!cache) return true;
    const req = new Request(`${CHANNEL_MSG_SLOT}${chatId}/${messageId}`);
    if ((await cache.match(req)) !== undefined) return false;
    await cache.put(
        req,
        new Response('1', {
            headers: { 'Cache-Control': 'public, max-age=86400' },
        })
    );
    return true;
}
