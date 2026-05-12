import { Bot, InputFile } from 'grammy';
import type { AccountInventory } from '../types';
import { UserService } from './userService';
import { PaymentService } from './paymentService';
import { InventoryService } from './inventoryService';
import { VpnAccountService } from './vpnAccountService';
import { ProductTypeService } from './productTypeService';
import { CatalogService } from './catalogService';
import { UserStep } from '../constants';
import { EXTENDED_MESSAGES } from '../extendedMessages';
import { escapeHtml, PARSE_HTML } from '../utils/telegramHtml';
import { formatSoldStockCard } from '../bot/stockCardMarkup';
import type { Payment } from '../types';

const NON_EXPIRING_ACCOUNT_DATE = '2099-12-31T00:00:00.000Z';

function accountCaption(username: string, password: string, expiryFa: string): string {
    return EXTENDED_MESSAGES.ACCOUNT_CREATED.replace(/\{USERNAME\}/g, escapeHtml(username))
        .replace(/\{PASSWORD\}/g, escapeHtml(password))
        .replace(/\{EXPIRY_DATE\}/g, escapeHtml(expiryFa));
}

function hasInventoryCredentials(inv: AccountInventory): boolean {
    return Boolean(inv.username?.trim() && inv.password?.trim());
}

function normalizeConnectionExt(format: string | null | undefined): string {
    if (format === 'v2ray') return 'json';
    if (format === 'openvpn') return 'ovpn';
    return 'conf';
}

function isSingleUrlPayload(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || /\s/.test(trimmed)) return false;
    return /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(trimmed);
}

/** First line or whole block that is a single subscription/config URL (handles trailing newlines / notes). */
function extractPrimarySubscriptionUrl(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const s = raw.replace(/\uFEFF/g, '').trim();
    if (isSingleUrlPayload(s)) return s.trim();
    for (const line of s.split(/\r?\n/)) {
        const t = line.trim();
        if (t && isSingleUrlPayload(t)) return t;
    }
    return null;
}

function resolveConnectionPayload(
    inv: AccountInventory,
    productType: { delivery_config_text?: string | null; delivery_config_format?: string | null } | null
): { text: string; ext: string; isUrl: boolean } | null {
    const raw =
        inv.config_text?.trim() ||
        (productType?.delivery_config_text ? productType.delivery_config_text.trim() : '');
    if (!raw) return null;
    const ext = normalizeConnectionExt(inv.config_format || productType?.delivery_config_format || null);
    const url = extractPrimarySubscriptionUrl(raw);
    if (url) {
        return { text: url, ext, isUrl: true };
    }
    const isUrl = isSingleUrlPayload(raw);
    return { text: raw, ext, isUrl };
}

function credentialessFileCaptionHtml(): string {
    return (
        `${EXTENDED_MESSAGES.VPN_ACCOUNT_SUCCESS_BANNER_HTML}\n\n` +
        '📎 <i>فایل کانفیگ اتصال پیوست است.</i>'
    );
}

async function sendConnectionPackage(params: {
    bot: Bot;
    telegramId: number;
    inv: AccountInventory;
    productTypeService: ProductTypeService;
    /** When true: success banner in file caption (credentialess non-URL). */
    credentialessMergeHelp?: boolean;
}): Promise<void> {
    const { bot, telegramId, inv, productTypeService, credentialessMergeHelp } = params;
    const productType = inv.product_type_id
        ? await productTypeService.getById(inv.product_type_id)
        : null;

    const captionHtml = credentialessMergeHelp
        ? credentialessFileCaptionHtml().slice(0, 1024)
        : 'فایل اتصال';

    if (inv.config_file_id) {
        await bot.api.sendDocument(telegramId, inv.config_file_id, {
            caption: captionHtml,
            parse_mode: PARSE_HTML,
        });
        return;
    }

    const payload = resolveConnectionPayload(inv, productType);
    if (payload) {
        if (payload.isUrl) {
            if (credentialessMergeHelp) {
                const msg = EXTENDED_MESSAGES.ACCOUNT_CREATED_LINK_ONLY.replace(
                    /\{LINK\}/g,
                    escapeHtml(payload.text)
                );
                await bot.api.sendMessage(telegramId, msg, { parse_mode: PARSE_HTML });
            } else {
                await bot.api.sendMessage(telegramId, `🔗 <b>لینک اتصال:</b>\n<code>${escapeHtml(payload.text)}</code>`, {
                    parse_mode: PARSE_HTML,
                });
            }
            return;
        }
        const bytes = new TextEncoder().encode(payload.text);
        await bot.api.sendDocument(telegramId, new InputFile(bytes, `connection-${inv.id}.${payload.ext}`), {
            caption: captionHtml,
            parse_mode: PARSE_HTML,
        });
        return;
    }

    if (credentialessMergeHelp) {
        await bot.api.sendMessage(telegramId, credentialessFileCaptionHtml(), { parse_mode: PARSE_HTML });
    }
}

async function sendVpnFulfillmentToUser(params: {
    bot: Bot;
    telegramId: number;
    inv: AccountInventory;
    productTypeService: ProductTypeService;
    isTestMode: boolean;
    expiryFa: string;
}): Promise<void> {
    const { bot, telegramId, inv, productTypeService, isTestMode, expiryFa } = params;
    const productType = inv.product_type_id
        ? await productTypeService.getById(inv.product_type_id)
        : null;
    const payload = resolveConnectionPayload(inv, productType);

    if (isTestMode) {
        const cap = EXTENDED_MESSAGES.TEST_MODE_ACCOUNT.replace(/\{USERNAME\}/g, escapeHtml(inv.username))
            .replace(/\{PASSWORD\}/g, escapeHtml(inv.password))
            .replace(/\{EXPIRY_DATE\}/g, escapeHtml(expiryFa));
        await bot.api.sendMessage(telegramId, cap, { parse_mode: PARSE_HTML });
        await sendConnectionPackage({ bot, telegramId, inv, productTypeService });
        return;
    }

    // Subscription URL (even with internal placeholder user/pass in DB).
    if (payload?.isUrl) {
        const msg = EXTENDED_MESSAGES.ACCOUNT_CREATED_LINK_ONLY.replace(/\{LINK\}/g, escapeHtml(payload.text));
        await bot.api.sendMessage(telegramId, msg, { parse_mode: PARSE_HTML });
        return;
    }

    if (hasInventoryCredentials(inv)) {
        await bot.api.sendMessage(telegramId, accountCaption(inv.username, inv.password, expiryFa), {
            parse_mode: PARSE_HTML,
        });
    }

    await sendConnectionPackage({
        bot,
        telegramId,
        inv,
        productTypeService,
        credentialessMergeHelp: !hasInventoryCredentials(inv),
    });
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
    catalogService: CatalogService;
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
        catalogService,
        userService,
        bot,
        paymentId,
        isTestMode,
        adminBotToken,
    } = params;

    const payment = await paymentService.getPaymentById(paymentId);
    if (!payment) return { ok: false, error: 'payment_not_found' };
    if (payment.status !== 'PENDING') return { ok: false, error: 'not_pending' };

    const plan = payment.plan;
    const planData = await catalogService.getPlanByInternalPlanKey(plan);
    const inv = await inventoryService.takeNextForPlan({
        planKey: plan,
        productTypeId: planData?.productTypeId ?? null,
        supplierId: planData?.supplierId ?? null,
    });
    if (!inv) {
        return { ok: false, error: 'no_inventory' };
    }

    const dbUser = await userService.getUserById(payment.user_id);
    if (!dbUser) {
        return { ok: false, error: 'user_not_found' };
    }

    const telegramId = dbUser.telegram_id;
    const expiryFa = 'نامحدود';

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
                plan,
                null,
                {
                    inventory_id: inv.id,
                    config_format: inv.config_format,
                    expiryDateIso: NON_EXPIRING_ACCOUNT_DATE,
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

    try {
        await sendVpnFulfillmentToUser({
            bot,
            telegramId,
            inv,
            productTypeService,
            isTestMode,
            expiryFa,
        });
    } catch (e) {
        console.error('[FULFILL] sendVpnFulfillmentToUser:', e);
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
    catalogService: CatalogService;
    bot: Bot;
    payment: Payment;
    isTestMode: boolean;
    adminBotToken?: string;
}): Promise<{ ok: boolean; error?: string }> {
    const {
        payment,
        inventoryService,
        vpnAccountService,
        catalogService,
        userService,
        bot,
        productTypeService,
        isTestMode,
        adminBotToken,
    } = params;

    const plan = payment.plan;
    const planData = await catalogService.getPlanByInternalPlanKey(plan);
    const inv = await inventoryService.takeNextForPlan({
        planKey: plan,
        productTypeId: planData?.productTypeId ?? null,
        supplierId: planData?.supplierId ?? null,
    });
    if (!inv) return { ok: false, error: 'no_inventory' };

    const dbUser = await userService.getUserById(payment.user_id);
    if (!dbUser) return { ok: false, error: 'user_not_found' };

    const telegramId = dbUser.telegram_id;
    const expiryFa = 'نامحدود';

    try {
        await inventoryService.markSold(inv.id, dbUser.id, payment.id);
    } catch {
        return { ok: false, error: 'reserve_failed' };
    }

    try {
        if (!isTestMode) {
            await vpnAccountService.createVpnAccount(dbUser.id, inv.username, inv.password, plan, null, {
                inventory_id: inv.id,
                config_format: inv.config_format,
                expiryDateIso: NON_EXPIRING_ACCOUNT_DATE,
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

    await sendVpnFulfillmentToUser({
        bot,
        telegramId,
        inv,
        productTypeService,
        isTestMode,
        expiryFa,
    });

    return { ok: true };
}
