import { escapeHtml } from './utils/telegramHtml';

/**
 * User conversation step states
 */
export enum UserStep {
    START = 'start',
    IDLE = 'idle',
    SELECTING_PLAN = 'selecting_plan',
    AWAITING_PAYMENT = 'awaiting_payment',
    /** @deprecated legacy — migrated to AWAITING_PAYMENT */
    AWAITING_USERNAME = 'awaiting_username',
    AWAITING_PASSWORD = 'awaiting_password',
    AWAITING_CARD_NUMBER = 'awaiting_card_number',
    ENTERING_PAYMENT = 'entering_payment',
    CONFIRMING_PAYMENT = 'confirming_payment',
    PAYMENT_COMPLETED = 'payment_completed',
}

/**
 * Available VPN plan keys and durations
 */
export type VpnPlanKey = '1month' | '3months';

/**
 * VPN plans with prices and duration in days
 */
export const VPN_PLANS: Record<
    VpnPlanKey,
    { name: string; price: number; days: number }
> = {
    '1month': {
        name: '🔥 یک ماهه 💰',
        price: 150000,
        days: 30,
    },
    '3months': {
        name: '⚡️ سه ماهه 💸',
        price: 400000,
        days: 90,
    },
};

/**
 * Payment status types
 */
export enum PaymentStatus {
    PENDING = 'pending',
    COMPLETED = 'completed',
    FAILED = 'failed',
    EXPIRED = 'expired',
}

/**
 * VPN types available
 */
export enum VpnType {
    OPENVPN = 'openvpn',
    V2RAY = 'v2ray',
}

/**
 * Customer-facing copy (Telegram HTML). Use with parse_mode: HTML.
 */
export const MESSAGES = {
    WELCOME:
        '✨ <b>به ربات VPNMasters خوش آمدید!</b> 🚀\n\n' +
        '🔐 <i>امن‌ترین و سریع‌ترین سرویس VPN با پشتیبانی 24/7</i>\n\n' +
        '👇 برای شروع، از منوی زیر گزینه مورد نظر خود را انتخاب کنید:',

    SELECT_PLAN:
        '📱 <b>انتخاب اشتراک VPN</b>\n\n' +
        '🔍 لطفاً مدت زمان اشتراک خود را انتخاب کنید:',

    PROMPT_USERNAME:
        '👤 <b>انتخاب نام کاربری</b>\n\n' +
        'لطفاً نام کاربری دلخواه خود را برای اکانت VPN وارد کنید.\n\n' +
        '⚠️ <i>نام کاربری باید حداقل 4 کاراکتر و فقط شامل حروف انگلیسی و اعداد باشد.</i>',

    USERNAME_INVALID:
        '❌ <b>نام کاربری نامعتبر است</b>\n\n' +
        'لطفاً یک نام کاربری دیگر وارد کنید که:\n' +
        '• حداقل 4 کاراکتر باشد\n' +
        '• فقط شامل حروف انگلیسی و اعداد باشد',

    USERNAME_ACCEPTED:
        '✅ <b>نام کاربری پذیرفته شد</b>\n' +
        '<i>نام کاربری شما با موفقیت ثبت شد.</i>',

    PROMPT_PASSWORD:
        '🔑 <b>انتخاب رمز عبور</b>\n\n' +
        'لطفاً رمز عبور دلخواه خود را برای اکانت VPN وارد کنید.\n\n' +
        '⚠️ <i>رمز عبور باید دقیقاً 4 رقم باشد.</i>',

    PASSWORD_INVALID:
        '❌ <b>رمز عبور نامعتبر است</b>\n\n' + 'لطفاً فقط 4 رقم وارد کنید.',

    PASSWORD_ACCEPTED:
        '✅ <b>رمز عبور پذیرفته شد</b>\n' +
        '<i>رمز عبور شما با موفقیت ثبت شد.</i>',

    PAYMENT_INSTRUCTIONS: (price: number, cardNumber: string) => {
        const safeCard = escapeHtml(cardNumber.replace(/\s/g, ''));
        const safePrice = escapeHtml(price.toLocaleString());
        return (
            `💳 <b>پرداخت اشتراک VPN</b>\n\n` +
            `💰 مبلغ: <b>${safePrice} تومان</b>\n\n` +
            `🏦 شماره کارت:\n` +
            `<code>${safeCard}</code>\n\n` +
            `📲 <i>پس از واریز، فقط 6 رقم آخر کارت خود را ارسال کنید.</i>\n\n` +
            `⏱ زمان باقیمانده برای پرداخت: <b>15 دقیقه</b>`
        );
    },

    PAYMENT_RECEIVED:
        '✅ <b>رسید شما دریافت شد</b>\n\n' +
        '⏳ پشتیبان پرداخت را بررسی می‌کند. پس از تایید، اطلاعات اکانت برای شما ارسال می‌شود.\n\n' +
        '<i>لطفاً صبور باشید.</i>',

    INVALID_CARD_NUMBER:
        '❌ <b>ورودی نامعتبر</b>\n\n' +
        'لطفاً <b>عکس رسید</b> یا <b>اسکرین‌شات پیامک بانک</b> را ارسال کنید.',

    HELP:
        '🔰 <b>راهنمای استفاده از VPNMasters</b>\n\n' +
        '1️⃣ «خرید اشتراک» را بزنید و پلن را انتخاب کنید\n' +
        '2️⃣ مبلغ را به شماره کارت اعلام‌شده واریز کنید\n' +
        '3️⃣ <b>عکس رسید</b> یا <b>اسکرین‌شات پیامک</b> را در ربات بفرستید\n' +
        '4️⃣ پس از تایید پشتیبان، اکانت از موجودی اختصاص داده می‌شود\n' +
        '5️⃣ از «اکانت‌های من» لیست اکانت‌های خریداری‌شده را ببینید\n\n' +
        '❓ <i>پشتیبانی از منوی پشتیبانی</i>',

    SUPPORT:
        '📞 <b>پشتیبانی VPNMasters</b>\n\n' +
        'برای ارتباط با پشتیبانی:\n' +
        'Telegram ID: <code>@support</code>\n\n' +
        '<i>پاسخگوی شما هستیم 7 روز هفته، 24 ساعته</i>',

    ERROR:
        '❌ <b>خطا در عملیات</b>\n\n' +
        'متأسفانه مشکلی پیش آمده است. لطفاً دوباره تلاش کنید.\n' +
        '<i>اگر مشکل ادامه داشت، با پشتیبانی تماس بگیرید.</i>',

    SELECT_VPN_TYPE:
        '🌐 <b>انتخاب نوع VPN</b>\n\n' +
        'لطفاً نوع VPN مورد نظر خود را انتخاب کنید:',

    VPN_CONFIG_OPENVPN:
        '📥 <b>فایل کانفیگ OpenVPN شما آماده است!</b>\n\n' +
        '<i>برای نصب و راه‌اندازی، فایل را دانلود کرده و طبق راهنما عمل کنید.</i>',

    VPN_CONFIG_V2RAY:
        '📥 <b>فایل کانفیگ V2Ray شما آماده است!</b>\n\n' +
        '<i>برای نصب و راه‌اندازی، فایل را دانلود کرده و طبق راهنما عمل کنید.</i>',
} as const;
