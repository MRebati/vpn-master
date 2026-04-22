import type { VpnProductType } from '../types';
import { escapeHtml, PARSE_HTML } from '../utils/telegramHtml';

/** Bot API inline result (article). */
type InlineArticle = {
    type: 'article';
    id: string;
    title: string;
    description?: string;
    input_message_content: {
        message_text: string;
        parse_mode?: string;
    };
};

/** Normalize for loose Persian search (ي/ك → ی/ک). */
export function normalizeInlineSearch(s: string): string {
    return s
        .trim()
        .toLowerCase()
        .replace(/ي/g, 'ی')
        .replace(/ك/g, 'ک');
}

export function filterProductTypesForInline(
    types: VpnProductType[],
    queryRaw: string
): VpnProductType[] {
    const q = normalizeInlineSearch(queryRaw);
    if (!q) return types;
    return types.filter((t) => {
        const label = normalizeInlineSearch(t.label_fa);
        const slug = t.slug.toLowerCase();
        return label.includes(q) || slug.includes(q) || q.includes(slug);
    });
}

function typeDescription(t: VpnProductType): string {
    if (t.unit === 'days') return `${t.metric_value} روز · ${t.slug}`;
    return `${t.metric_value} گیگ · ${t.slug}`;
}

function typeSelectedMessageText(t: VpnProductType): string {
    const unitLine =
        t.unit === 'days'
            ? `⏱ <b>مدت:</b> ${escapeHtml(String(t.metric_value))} روز`
            : `📶 <b>حجم:</b> ${escapeHtml(String(t.metric_value))} GB`;
    return (
        `✅ <b>نوع برای ورودی بعدی انتخاب شد</b>\n\n` +
        `🏷 ${escapeHtml(t.label_fa)}\n` +
        `${unitLine}\n` +
        `🔖 <code>${escapeHtml(t.slug)}</code>\n\n` +
        `حالا بلاک <b>User / Pass</b> را بفرستید، یا از نتیجه «قالب» استفاده کنید.`
    );
}

export function buildProductTypeArticles(types: VpnProductType[]): InlineArticle[] {
    return types.map((t) => ({
        type: 'article',
        id: `pt:${t.id}`,
        title: t.label_fa,
        description: typeDescription(t),
        input_message_content: {
            message_text: typeSelectedMessageText(t),
            parse_mode: PARSE_HTML,
        },
    }));
}

export function buildTemplateUserPassArticle(): InlineArticle {
    return {
        type: 'article',
        id: 'tpl:userpass',
        title: 'قالب User / Pass',
        description: 'بلاک آماده برای پر کردن',
        input_message_content: {
            message_text:
                '<b>User</b>\n' +
                '<code>نام_کاربری_را_اینجا</code>\n\n' +
                '<b>Pass</b>\n' +
                '<code>رمز_را_اینجا</code>',
            parse_mode: PARSE_HTML,
        },
    };
}

export function buildInlineHelpArticle(): InlineArticle {
    return {
        type: 'article',
        id: 'help:inline',
        title: 'راهنمای اینلاین',
        description: 'چطور از @ ربات در کانال استفاده کنیم',
        input_message_content: {
            message_text:
                '🔰 <b>حالت اینلاین ربات مدیریت</b>\n\n' +
                '۱) در کادر پیام بنویسید: <code>@نام_ربات</code> و یک فاصله\n' +
                '۲) برای دیدن همه نوع‌ها، چیزی ننویسید یا نام فارسی/اسلاگ را تایپ کنید\n' +
                '۳) یکی از نتایج را بزنید تا همینجا ارسال شود\n' +
                '۴) پس از انتخاب «نوع»، بلاک User/Pass را بفرستید\n\n' +
                '<i>فقط اعضای تیم (لیست staff) می‌توانند نوع را فعال کنند؛ بقیه فقط پیام راهنما می‌بینند.</i>',
            parse_mode: PARSE_HTML,
        },
    };
}

export function buildAccessDeniedArticle(): InlineArticle {
    return {
        type: 'article',
        id: 'denied:staff',
        title: 'دسترسی محدود',
        description: 'فقط تیم پشتیبانی',
        input_message_content: {
            message_text:
                '⛔️ این بخش فقط برای <b>اعضای تیم</b> است.\n' +
                'در صورت نیاز با ادمین تماس بگیرید.',
            parse_mode: PARSE_HTML,
        },
    };
}
