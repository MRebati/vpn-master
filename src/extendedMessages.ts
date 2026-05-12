import { MESSAGES } from './constants';

export const EXTENDED_MESSAGES = {
    ...MESSAGES,
    ACCOUNT_CREATED:
        '✅ <b>اکانت VPN شما با موفقیت ایجاد شد!</b>\n\n' +
        '👤 نام کاربری: <code>{USERNAME}</code>\n' +
        '🔐 رمز عبور: <code>{PASSWORD}</code>\n' +
        '📆 تاریخ انقضا: <b>{EXPIRY_DATE}</b>\n\n' +
        '🔒 <i>لطفاً این اطلاعات را در جای امنی نگهداری کنید.</i>\n\n' +
        '📱 برای راهنمای اتصال، روی دکمه «راهنمای اتصال» کلیک کنید.',

    TEST_MODE_ACCOUNT:
        '🔧 <b>حالت آزمایشی فعال است</b>\n\n' +
        '👤 نام کاربری تست: <code>{USERNAME}</code>\n' +
        '🔐 رمز عبور تست: <code>{PASSWORD}</code>\n' +
        '📆 تاریخ انقضا: <b>{EXPIRY_DATE}</b>\n\n' +
        '⚠️ <i>این یک اکانت تست است و کار نخواهد کرد. در حالت عادی، پس از تایید پرداخت، اکانت واقعی برای شما ایجاد خواهد شد.</i>',

    /** Single DM when delivery is a subscription URL (no separate user/pass or help messages). */
    ACCOUNT_CREATED_LINK_ONLY:
        '✅ <b>اکانت VPN شما با موفقیت ایجاد شد!</b> 🎉\n\n' +
        '🔗 <b>لینک اتصال:</b>\n' +
        '<code>{LINK}</code>\n\n' +
        '🚀 برای دستیابی به کانفیگ و اطلاعات مصرف وارد لینک بالا شوید.',

    VPN_ACCOUNT_SUCCESS_BANNER_HTML: '✅ <b>اکانت VPN شما با موفقیت ایجاد شد!</b> 🎉',
};
