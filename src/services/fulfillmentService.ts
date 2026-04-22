import { Bot, InputFile } from 'grammy';
import type { AccountInventory } from '../types';
import { UserService } from './userService';
import { PaymentService } from './paymentService';
import { InventoryService } from './inventoryService';
import { VpnAccountService } from './vpnAccountService';
import { ProductTypeService } from './productTypeService';
import { UserStep, VPN_PLANS, VpnPlanKey } from '../constants';
import { EXTENDED_MESSAGES } from '../extendedMessages';
import { escapeHtml, PARSE_HTML } from '../utils/telegramHtml';
import { formatSoldStockCard } from '../bot/stockCardMarkup';

function accountCaption(username: string, password: string, expiryFa: string): string {
    return EXTENDED_MESSAGES.ACCOUNT_CREATED.replace(/\{USERNAME\}/g, escapeHtml(username))
        .replace(/\{PASSWORD\}/g, escapeHtml(password))
        .replace(/\{EXPIRY_DATE\}/g, escapeHtml(expiryFa));
}

async function computeAccountExpiry(
    inv: AccountInventory,
    planSlug: string,
    productTypes: ProductTypeService
): Promise<{ expiryIso: string; expiryFa: string }> {
    if (inv.product_type_id) {
        const pt = await productTypes.getById(inv.product_type_id);
        if (pt) {
            if (pt.unit === 'days') {
                const d = new Date();
                d.setDate(d.getDate() + Number(pt.metric_value));
                return {
                    expiryIso: d.toISOString(),
                    expiryFa: d.toLocaleDateString('fa-IR'),
                };
            }
            const d = new Date();
            d.setFullYear(d.getFullYear() + 1);
            const label = `${pt.metric_value} GB · ${pt.label_fa}`;
            return { expiryIso: d.toISOString(), expiryFa: label };
        }
    }
    const plan = planSlug as VpnPlanKey;
    if (VPN_PLANS[plan]) {
        const d = new Date();
        d.setDate(d.getDate() + VPN_PLANS[plan].days);
        return {
            expiryIso: d.toISOString(),
            expiryFa: d.toLocaleDateString('fa-IR'),
        };
    }
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return {
        expiryIso: d.toISOString(),
        expiryFa: d.toLocaleDateString('fa-IR'),
    };
}

async function tryEditSoldStockMessage(params: {
    adminBotToken?: string;
    inventoryService: InventoryService;
    productTypeService: ProductTypeService;
    userService: UserService;
    invId: number;
}): Promise<void> {
    const { adminBotToken, inventoryService, productTypeService, userService, invId } =
        params;
    if (!adminBotToken) return;

    const inv = await inventoryService.getById(invId);
    if (!inv || inv.stock_message_id == null || inv.stock_chat_id == null) return;

    const buyer = inv.sold_user_id
        ? await userService.getUserById(inv.sold_user_id)
        : null;
    const pt = inv.product_type_id
        ? await productTypeService.getById(inv.product_type_id)
        : null;

    const text = formatSoldStockCard({ inv, productType: pt, buyer: buyer ?? null });
    try {
        const adminBot = new Bot(adminBotToken);
        await adminBot.api.editMessageText(
            Number(inv.stock_chat_id),
            inv.stock_message_id,
            text,
            { parse_mode: PARSE_HTML }
        );
    } catch (e) {
        console.error('[FULFILL] edit stock card:', e);
    }
}

/**
 * After admin approval: reserve inventory, create vpn_accounts row, complete payment, DM user.
 */
export async function fulfillPaymentAfterApproval(params: {
    userService: UserService;
    paymentService: PaymentService;
    inventoryService: InventoryService;
    vpnAccountService: VpnAccountService;
    productTypeService: ProductTypeService;
    bot: Bot;
    paymentId: number;
    isTestMode: boolean;
    adminBotToken?: string;
}): Promise<{ ok: boolean; error?: string }> {
    const {
        paymentService,
        inventoryService,
        vpnAccountService,
        productTypeService,
        userService,
        bot,
        paymentId,
        isTestMode,
        adminBotToken,
    } = params;

    const payment = await paymentService.getPaymentById(paymentId);
    if (!payment) return { ok: false, error: 'payment_not_found' };
    if (payment.status !== 'PENDING') return { ok: false, error: 'not_pending' };

    const planSlug = payment.plan;
    const inv = await inventoryService.takeNextForPlan(planSlug);
    if (!inv) {
        return { ok: false, error: 'no_inventory' };
    }

    const dbUser = await userService.getUserById(payment.user_id);
    if (!dbUser) {
        return { ok: false, error: 'user_not_found' };
    }

    const telegramId = dbUser.telegram_id;
    const { expiryIso, expiryFa } = await computeAccountExpiry(
        inv,
        planSlug,
        productTypeService
    );

    try {
        await inventoryService.markSold(inv.id, dbUser.id, paymentId);
    } catch (e) {
        return { ok: false, error: 'reserve_failed' };
    }

    try {
        if (!isTestMode) {
            await vpnAccountService.createVpnAccount(
                dbUser.id,
                inv.username,
                inv.password,
                planSlug,
                {
                    inventory_id: inv.id,
                    config_format: inv.config_format,
                    expiryDateIso: expiryIso,
                }
            );
        }
    } catch (e) {
        await inventoryService.releaseBack(inv.id);
        return { ok: false, error: 'vpn_create_failed' };
    }

    await paymentService.updatePaymentStatus(paymentId, 'COMPLETED');
    await paymentService.setReviewStatus(paymentId, 'approved');
    await userService.setUserStep(dbUser.id, UserStep.IDLE);

    await tryEditSoldStockMessage({
        adminBotToken,
        inventoryService,
        productTypeService,
        userService,
        invId: inv.id,
    });

    const cap = isTestMode
        ? EXTENDED_MESSAGES.TEST_MODE_ACCOUNT.replace(/\{USERNAME\}/g, escapeHtml(inv.username))
              .replace(/\{PASSWORD\}/g, escapeHtml(inv.password))
              .replace(/\{EXPIRY_DATE\}/g, escapeHtml(expiryFa))
        : accountCaption(inv.username, inv.password, expiryFa);

    try {
        await bot.api.sendMessage(telegramId, cap, { parse_mode: PARSE_HTML });
    } catch (e) {
        console.error('[FULFILL] sendMessage:', e);
    }

    const ext =
        inv.config_format === 'v2ray'
            ? 'json'
            : inv.config_format === 'openvpn'
              ? 'ovpn'
              : 'conf';

    try {
        if (inv.config_text) {
            const bytes = new TextEncoder().encode(inv.config_text);
            await bot.api.sendDocument(
                telegramId,
                new InputFile(bytes, `vpn-${inv.id}.${ext}`),
                { caption: 'فایل کانفیگ' }
            );
        } else if (inv.config_file_id) {
            await bot.api.sendDocument(telegramId, inv.config_file_id, {
                caption: 'فایل کانفیگ',
            });
        }
    } catch (e) {
        console.error('[FULFILL] sendDocument:', e);
    }

    return { ok: true };
}

/**
 * Manual sale: payment row already COMPLETED (e.g. support sold by hand).
 */
export async function deliverInventoryForCompletedPayment(params: {
    userService: UserService;
    paymentService: PaymentService;
    inventoryService: InventoryService;
    vpnAccountService: VpnAccountService;
    productTypeService: ProductTypeService;
    bot: Bot;
    payment: Payment;
    isTestMode: boolean;
    adminBotToken?: string;
}): Promise<{ ok: boolean; error?: string }> {
    const {
        payment,
        inventoryService,
        vpnAccountService,
        userService,
        bot,
        productTypeService,
        isTestMode,
        adminBotToken,
    } = params;

    const planSlug = payment.plan;
    const inv = await inventoryService.takeNextForPlan(planSlug);
    if (!inv) return { ok: false, error: 'no_inventory' };

    const dbUser = await userService.getUserById(payment.user_id);
    if (!dbUser) return { ok: false, error: 'user_not_found' };

    const telegramId = dbUser.telegram_id;
    const { expiryIso, expiryFa } = await computeAccountExpiry(
        inv,
        planSlug,
        productTypeService
    );

    try {
        await inventoryService.markSold(inv.id, dbUser.id, payment.id);
    } catch {
        return { ok: false, error: 'reserve_failed' };
    }

    try {
        if (!isTestMode) {
            await vpnAccountService.createVpnAccount(dbUser.id, inv.username, inv.password, planSlug, {
                inventory_id: inv.id,
                config_format: inv.config_format,
                expiryDateIso: expiryIso,
            });
        }
    } catch (e) {
        await inventoryService.releaseBack(inv.id);
        return { ok: false, error: 'vpn_create_failed' };
    }

    await tryEditSoldStockMessage({
        adminBotToken,
        inventoryService,
        productTypeService,
        userService,
        invId: inv.id,
    });

    const cap = isTestMode
        ? EXTENDED_MESSAGES.TEST_MODE_ACCOUNT.replace(/\{USERNAME\}/g, escapeHtml(inv.username))
              .replace(/\{PASSWORD\}/g, escapeHtml(inv.password))
              .replace(/\{EXPIRY_DATE\}/g, escapeHtml(expiryFa))
        : accountCaption(inv.username, inv.password, expiryFa);

    await bot.api.sendMessage(telegramId, cap, { parse_mode: PARSE_HTML });

    const ext =
        inv.config_format === 'v2ray'
            ? 'json'
            : inv.config_format === 'openvpn'
              ? 'ovpn'
              : 'conf';

    if (inv.config_text) {
        const bytes = new TextEncoder().encode(inv.config_text);
        await bot.api.sendDocument(telegramId, new InputFile(bytes, `vpn-${inv.id}.${ext}`));
    } else if (inv.config_file_id) {
        await bot.api.sendDocument(telegramId, inv.config_file_id);
    }

    return { ok: true };
}
