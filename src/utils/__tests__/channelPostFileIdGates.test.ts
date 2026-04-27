import { describe, it, expect } from 'vitest';
import { isCrmReceiptLikeChannelPost } from '../channelPostFileIdGates';

describe('isCrmReceiptLikeChannelPost', () => {
    it('detects bank receipt caption', () => {
        expect(
            isCrmReceiptLikeChannelPost({
                caption: '🔔 <b>رسید پرداخت</b>\n\n👤 x\n💰 1 تومان',
            } as any)
        ).toBe(true);
    });

    it('detects crypto review caption', () => {
        expect(
            isCrmReceiptLikeChannelPost({
                caption: '🔔 <b>درخواست بررسی پرداخت رمزارزی</b>',
            } as any)
        ).toBe(true);
    });

    it('detects approve keyboard', () => {
        expect(
            isCrmReceiptLikeChannelPost({
                caption: 'x',
                reply_markup: {
                    inline_keyboard: [[{ text: 'ok', callback_data: 'ap:12' }]],
                },
            } as any)
        ).toBe(true);
    });

    it('returns false for plain staff upload', () => {
        expect(
            isCrmReceiptLikeChannelPost({
                caption: 'my config',
            } as any)
        ).toBe(false);
    });
});
