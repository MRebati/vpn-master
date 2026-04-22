import { Bot, Context } from 'grammy';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types';
import type { Env } from '../index';
import { UserService } from '../services/userService';
import { PaymentService } from '../services/paymentService';
import { InventoryService } from '../services/inventoryService';
import { VpnAccountService } from '../services/vpnAccountService';
import { SettingsService } from '../services/settingsService';
import { deliverInventoryForCompletedPayment } from '../services/fulfillmentService';
import { CatalogService } from '../services/catalogService';
import { canActAsStaff } from '../utils/staffAccess';

export type AdminBotContext = Context & { env: Env };

/**
 * Separate Telegram bot for staff: card number, support text, stock, manual delivery.
 * Uses the same Worker env; customer DMs go through BOT_TOKEN (main bot).
 */
export class AdminBotManager {
    private bot: Bot<AdminBotContext>;
    /** Used only for api.sendMessage/sendDocument to buyers (they talked to the main bot). */
    private customerApi: Bot['api'];
    private env: Env;
    private userService: UserService;
    private paymentService: PaymentService;
    private inventoryService: InventoryService;
    private vpnAccountService: VpnAccountService;
    private settingsService: SettingsService;
    private catalogService: CatalogService;
    private initialized = false;

    constructor(env: Env) {
        const adminToken = env.ADMIN_BOT_TOKEN;
        if (!adminToken) {
            throw new Error('ADMIN_BOT_TOKEN is not set');
        }
        this.env = env;
        this.bot = new Bot<AdminBotContext>(adminToken);
        this.customerApi = new Bot(env.BOT_TOKEN).api;

        const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_KEY;
        if (!supabaseKey) {
            throw new Error('Missing Supabase key');
        }
        const supabase = createClient<Database>(env.SUPABASE_URL, supabaseKey);
        this.userService = new UserService(supabase);
        this.paymentService = new PaymentService(
            supabase,
            env.ADMIN_USER_ID,
            env.CARD_NUMBER,
            undefined,
            env.CHANNEL_ID
        );
        this.inventoryService = new InventoryService(supabase);
        this.vpnAccountService = new VpnAccountService(supabase);
        this.settingsService = new SettingsService(supabase);
        this.catalogService = new CatalogService(supabase);

        this.bot.use((ctx, next) => {
            ctx.env = env;
            return next();
        });

        this.registerHandlers();
    }

    private registerHandlers() {
        this.bot.command('start', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) {
                await ctx.reply('Access denied.');
                return;
            }
            await ctx.reply(
                [
                    'Admin bot commands:',
                    '(Use here or in STAFF_CHANNEL_ID group; DMs need ADMIN/STAFF_USER_IDS.)',
                    '/setcard <number> — bank card shown to customers',
                    '/setsupport <text> — support message for customers',
                    '/addstock <user> <pass> [plan_key] [openvpn|v2ray]',
                    '/stock — available counts',
                    '/deliver <telegram_id> <plan_key> — manual sale (uses inventory)',
                ].join('\n')
            );
        });

        this.bot.command('setcard', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const text = ctx.message?.text ?? '';
            const card = text.replace(/^\/setcard\s*/i, '').trim();
            if (!/^\d{10,19}$/.test(card.replace(/\s/g, ''))) {
                await ctx.reply('Usage: /setcard 6104123456789012');
                return;
            }
            await this.settingsService.setCardNumber(card.replace(/\s/g, ''));
            await ctx.reply('Card number updated.');
        });

        this.bot.command('setsupport', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const text = ctx.message?.text ?? '';
            const msg = text.replace(/^\/setsupport\s*/i, '').trim();
            if (!msg) {
                await ctx.reply('Usage: /setsupport @channel or text');
                return;
            }
            await this.settingsService.setSupportChannel(msg);
            await ctx.reply('Support info updated.');
        });

        this.bot.command('addstock', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const text = ctx.message?.text ?? '';
            const rest = text.replace(/^\/addstock\s*/i, '').trim().split(/\s+/);
            if (rest.length < 2) {
                await ctx.reply(
                    'Usage: /addstock <username> <password> [plan_key] [openvpn|v2ray]'
                );
                return;
            }
            const username = rest[0];
            const password = rest[1];
            let plan: string | null = null;
            let format = 'openvpn';
            if (rest[2]) {
                if (rest[2] === 'openvpn' || rest[2] === 'v2ray') {
                    format = rest[2];
                } else {
                    plan = rest[2];
                    if (rest[3] === 'openvpn' || rest[3] === 'v2ray') format = rest[3];
                }
            }
            const row = await this.inventoryService.addRow({
                username,
                password,
                plan_key: plan,
                config_format: format,
            });
            await ctx.reply(`Stock added id=${row.id} (${row.plan_key ?? 'any plan'})`);
        });

        this.bot.command('stock', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const any = await this.inventoryService.countAvailable();
            await ctx.reply(`Available (any plan match): ${any}`);
        });

        this.bot.command('deliver', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const text = ctx.message?.text ?? '';
            const rest = text.replace(/^\/deliver\s*/i, '').trim().split(/\s+/);
            if (rest.length < 2) {
                await ctx.reply('Usage: /deliver <telegram_user_id> <plan_key>');
                return;
            }
            const tgId = Number(rest[0]);
            const plan = rest[1];
            const planData = await this.catalogService.getPlanByInternalPlanKey(plan);
            if (!planData) {
                await ctx.reply('Unknown plan key.');
                return;
            }
            const user = await this.userService.getOrCreateUser(
                tgId,
                'Customer',
                undefined
            );
            const payment = await this.paymentService.createManualCompletedPayment(
                user.id,
                plan,
                planData.priceToman
            );
            const isTest = this.env.TEST_MODE === 'true';
            const r = await deliverInventoryForCompletedPayment({
                userService: this.userService,
                paymentService: this.paymentService,
                inventoryService: this.inventoryService,
                vpnAccountService: this.vpnAccountService,
                catalogService: this.catalogService,
                bot: new Bot(this.env.BOT_TOKEN),
                payment,
                isTestMode: isTest,
            });
            if (!r.ok) {
                await ctx.reply(`Deliver failed: ${r.error ?? 'unknown'}`);
                return;
            }
            await ctx.reply(`Delivered payment ${payment.id} to telegram ${tgId}`);
        });
    }

    async init() {
        if (!this.initialized) {
            await this.bot.init();
            this.initialized = true;
        }
    }

    async processUpdate(update: unknown): Promise<boolean> {
        try {
            await this.init();
            await this.bot.handleUpdate(update as any);
            return true;
        } catch (e) {
            console.error('[ADMIN_BOT]', e);
            return false;
        }
    }
}
