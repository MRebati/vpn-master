import type { AccountInventory, User, VpnProductType } from '../types';
import { escapeHtml } from '../utils/telegramHtml';

function formatTypeLine(pt: VpnProductType | null): string {
    if (!pt) return '—';
    if (pt.unit === 'days') {
        return `${escapeHtml(pt.label_fa)} · ${escapeHtml(String(pt.metric_value))} روز`;
    }
    return `${escapeHtml(pt.label_fa)} · ${escapeHtml(String(pt.metric_value))} GB`;
}

/** Staff-facing inventory card (HTML). */
export function formatAvailableStockCard(params: {
    inv: AccountInventory;
    productType: VpnProductType | null;
}): string {
    const { inv, productType } = params;
    const typeLine = formatTypeLine(productType);
    return (
        `📦 <b>موجودی #${inv.id}</b>\n` +
        `🏷 <b>نوع:</b> ${typeLine}\n` +
        `🔌 <b>فرمت:</b> ${escapeHtml(inv.config_format ?? 'openvpn')}\n\n` +
        `👤 <code>${escapeHtml(inv.username)}</code>\n` +
        `🔐 <code>${escapeHtml(inv.password)}</code>\n\n` +
        `✅ <b>وضعیت:</b> <i>موجود برای فروش</i>\n` +
        `📅 <b>ثبت:</b> ${escapeHtml(new Date(inv.created_at).toLocaleString('fa-IR'))}`
    );
}

export function formatSoldStockCard(params: {
    inv: AccountInventory;
    productType: VpnProductType | null;
    buyer: User | null;
}): string {
    const { inv, productType, buyer } = params;
    const typeLine = formatTypeLine(productType);
    const soldAt = inv.sold_at
        ? escapeHtml(new Date(inv.sold_at).toLocaleString('fa-IR'))
        : '—';
    const buyerLine = buyer
        ? `${escapeHtml(buyer.first_name)} · tg: <code>${buyer.telegram_id}</code> · db #${buyer.id}`
        : inv.sold_user_id
          ? `کاربر دیتابیس #${inv.sold_user_id}`
          : '—';

    return (
        `📦 <b>موجودی #${inv.id}</b>\n` +
        `🏷 <b>نوع:</b> ${typeLine}\n` +
        `🔌 <b>فرمت:</b> ${escapeHtml(inv.config_format ?? 'openvpn')}\n\n` +
        `👤 <code>${escapeHtml(inv.username)}</code>\n` +
        `🔐 <code>${escapeHtml(inv.password)}</code>\n\n` +
        `🔴 <b>وضعیت:</b> <i>فروخته شد</i>\n` +
        `📅 <b>فروش:</b> ${soldAt}\n` +
        `🛒 <b>خریدار:</b> ${buyerLine}\n` +
        (inv.sold_payment_id ? `💳 <b>پرداخت:</b> #${inv.sold_payment_id}` : '')
    );
}
