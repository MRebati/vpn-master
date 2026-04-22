import { Bot, InputFile } from 'grammy';
import type { Payment } from '../types';
import { UserService } from './userService';
import { PaymentService } from './paymentService';
import { InventoryService } from './inventoryService';
import { VpnAccountService } from './vpnAccountService';
import { CatalogService } from './catalogService';
import { UserStep } from '../constants';
import { EXTENDED_MESSAGES } from '../extendedMessages';

function escapeMdV2(s: string): string {
    return s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function accountCaption(username: string, password: string, expiryFa: string): string {
    return (
        EXTENDED_MESSAGES.ACCOUNT_CREATED.replace(/\{USERNAME\}/g, escapeMdV2(username))
            .replace(/\{PASSWORD\}/g, escapeMdV2(password))
            .replace(/\{EXPIRY_DATE\}/g, escapeMdV2(expiryFa))
    );
}

/**
 * After admin approval: reserve inventory, create vpn_accounts row, complete payment, DM user.
 */
export async function fulfillPaymentAfterApproval(params: {
    userService: UserService;
    paymentService: PaymentService;
    inventoryService: InventoryService;
    vpnAccountService: VpnAccountService;
    catalogService: CatalogService;
    bot: Bot;
    paymentId: number;
    isTestMode: boolean;
}): Promise<{ ok: boolean; error?: string }> {
    const {
        paymentService,
        inventoryService,
        vpnAccountService,
        catalogService,
        userService,
        bot,
        paymentId,
        isTestMode,
    } = params;

    const payment = await paymentService.getPaymentById(paymentId);
    if (!payment) return { ok: false, error: 'payment_not_found' };
    if (payment.status !== 'PENDING') return { ok: false, error: 'not_pending' };

    const plan = payment.plan;
    const inv = await inventoryService.takeNextForPlan(plan);
    if (!inv) {
        return { ok: false, error: 'no_inventory' };
    }

    const dbUser = await userService.getUserById(payment.user_id);
    if (!dbUser) {
        return { ok: false, error: 'user_not_found' };
    }

    const telegramId = dbUser.telegram_id;
    const planData = await catalogService.getPlanByInternalPlanKey(plan);
    const planDays = planData?.unit === 'days' ? Number(planData.metricValue) : 0;
    if (!Number.isFinite(planDays) || planDays <= 0) {
        return { ok: false, error: 'invalid_plan_days' };
    }
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + planDays);
    const expiryFa = expiryDate.toLocaleDateString('fa-IR');

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
                planDays,
                {
                    inventory_id: inv.id,
                    config_format: inv.config_format,
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

    const cap = isTestMode
        ? EXTENDED_MESSAGES.TEST_MODE_ACCOUNT.replace(/\{USERNAME\}/g, escapeMdV2(inv.username))
              .replace(/\{PASSWORD\}/g, escapeMdV2(inv.password))
              .replace(/\{EXPIRY_DATE\}/g, escapeMdV2(expiryFa))
        : accountCaption(inv.username, inv.password, expiryFa);

    try {
        await bot.api.sendMessage(telegramId, cap, { parse_mode: 'MarkdownV2' });
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
    catalogService: CatalogService;
    bot: Bot;
    payment: Payment;
    isTestMode: boolean;
}): Promise<{ ok: boolean; error?: string }> {
    const {
        payment,
        inventoryService,
        vpnAccountService,
        catalogService,
        userService,
        bot,
        isTestMode,
    } = params;

    const plan = payment.plan;
    const inv = await inventoryService.takeNextForPlan(plan);
    if (!inv) return { ok: false, error: 'no_inventory' };

    const dbUser = await userService.getUserById(payment.user_id);
    if (!dbUser) return { ok: false, error: 'user_not_found' };

    const telegramId = dbUser.telegram_id;
    const planData = await catalogService.getPlanByInternalPlanKey(plan);
    const planDays = planData?.unit === 'days' ? Number(planData.metricValue) : 0;
    if (!Number.isFinite(planDays) || planDays <= 0) return { ok: false, error: 'invalid_plan_days' };
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + planDays);
    const expiryFa = expiryDate.toLocaleDateString('fa-IR');

    try {
        await inventoryService.markSold(inv.id, dbUser.id, payment.id);
    } catch {
        return { ok: false, error: 'reserve_failed' };
    }

    try {
        if (!isTestMode) {
            await vpnAccountService.createVpnAccount(dbUser.id, inv.username, inv.password, plan, planDays, {
                inventory_id: inv.id,
                config_format: inv.config_format,
            });
        }
    } catch (e) {
        await inventoryService.releaseBack(inv.id);
        return { ok: false, error: 'vpn_create_failed' };
    }

    const cap = isTestMode
        ? EXTENDED_MESSAGES.TEST_MODE_ACCOUNT.replace(/\{USERNAME\}/g, escapeMdV2(inv.username))
              .replace(/\{PASSWORD\}/g, escapeMdV2(inv.password))
              .replace(/\{EXPIRY_DATE\}/g, escapeMdV2(expiryFa))
        : accountCaption(inv.username, inv.password, expiryFa);

    await bot.api.sendMessage(telegramId, cap, { parse_mode: 'MarkdownV2' });

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
