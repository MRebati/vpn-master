import { Bot, Context, InlineKeyboard } from 'grammy';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types';
import type { Env } from '../index';
import { UserService } from '../services/userService';
import { PaymentService } from '../services/paymentService';
import { InventoryService } from '../services/inventoryService';
import { VpnAccountService } from '../services/vpnAccountService';
import { SettingsService } from '../services/settingsService';
import { ProductTypeService } from '../services/productTypeService';
import { deliverInventoryForCompletedPayment } from '../services/fulfillmentService';
import { CatalogService } from '../services/catalogService';
import {
    canActAsStaff,
    canUseStockPaste,
    isStaffUserId,
    isStaffWorkspaceChannelChat,
    resolveTelegramChannelChatId,
} from '../utils/staffAccess';
import { escapeHtml, PARSE_HTML } from '../utils/telegramHtml';
import {
    inferConfigFormat,
    parseBulkStockRows,
    parseUserPassBlock,
} from '../utils/parseStockCredential';
import { formatAvailableStockCard } from './stockCardMarkup';
import {
    buildAccessDeniedArticle,
    buildInlineHelpArticle,
    buildProductTypeArticles,
    buildTemplateUserPassArticle,
    filterProductTypesForInline,
    normalizeInlineSearch,
} from './adminInlineQuery';

export type AdminBotContext = Context & { env: Env };

/**
 * ربات مدیریت: کارت، پشتیبانی، انواع VPN، ثبت موجودی، تحویل دستی.
 */
export class AdminBotManager {
    private bot: Bot<AdminBotContext>;
    private env: Env;
    private userService: UserService;
    private paymentService: PaymentService;
    private inventoryService: InventoryService;
    private vpnAccountService: VpnAccountService;
    private settingsService: SettingsService;
    private catalogService: CatalogService;
    private productTypeService: ProductTypeService;
    private initialized = false;

    constructor(env: Env) {
        const adminToken = env.ADMIN_BOT_TOKEN;
        if (!adminToken) {
            throw new Error('ADMIN_BOT_TOKEN is not set');
        }
        this.env = env;
        this.bot = new Bot<AdminBotContext>(adminToken);

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
        this.productTypeService = new ProductTypeService(supabase);

        this.bot.use((ctx, next) => {
            ctx.env = env;
            return next();
        });

        this.registerHandlers();
    }

    private stockAnnounceChatId(): string | null {
        return (
            resolveTelegramChannelChatId(this.env.STOCK_CHANNEL_ID) ??
            resolveTelegramChannelChatId(this.env.STAFF_CHANNEL_ID)
        );
    }

    private formatPlanLabel(planKey: string | null): string {
        if (!planKey) return 'هر پلن';
        if (planKey === '1month' || planKey === '3months') {
            return planKey === '1month' ? 'یک‌ماهه' : 'سه‌ماهه';
        }
        return planKey;
    }

    private formatFormatLabel(f: string): string {
        if (f === 'v2ray') return 'V2Ray';
        if (f === 'openvpn') return 'OpenVPN';
        return f;
    }

    private generatedStockUsername(baseSlug: string, index: number): string {
        const stamp = Date.now().toString(36);
        return `${baseSlug || 'stock'}-${stamp}-${index}`;
    }

    private async resolvePendingStockType(ctx: AdminBotContext) {
        const ptId = await this.settingsService.getPendingStockProductType(ctx.from!.id);
        if (!ptId) {
            await ctx.reply(
                'ابتدا نوع را مشخص کنید:\n' +
                    '• <b>/types</b> یا دکمه‌های شیشه‌ای\n' +
                    '• یا اینلاین: <code>@…</code> + جستجو و انتخاب نوع\n\n' +
                    'بعد بلاک User/Pass یا فایل CSV/TXT را بفرستید.',
                { parse_mode: PARSE_HTML }
            );
            return null;
        }

        const pt = await this.productTypeService.getById(ptId);
        if (!pt || !pt.is_active) {
            await this.settingsService.setPendingStockProductType(ctx.from!.id, null);
            await ctx.reply('نوع انتخاب‌شده دیگر معتبر نیست. دوباره /types را بزنید.', {
                parse_mode: PARSE_HTML,
            });
            return null;
        }
        return pt;
    }

    private async ingestBulkRows(
        ctx: AdminBotContext,
        rows: ReturnType<typeof parseBulkStockRows>,
        sourceLabel: string
    ): Promise<void> {
        const pt = await this.resolvePendingStockType(ctx);
        if (!pt) return;

        let inserted = 0;
        const failed: string[] = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]!;
            const configText = row.configText?.trim() || null;
            const derivedFormat = row.configFormat ?? inferConfigFormat(configText);
            const fallbackFormat = pt.delivery_config_format === 'v2ray' ? 'v2ray' : 'openvpn';
            const format = derivedFormat ?? fallbackFormat;
            const username =
                row.username?.trim() ||
                this.generatedStockUsername(pt.slug || 'stock', i + 1);
            const password = row.password?.trim() || 'AUTO';

            try {
                await this.inventoryService.addRow({
                    username,
                    password,
                    product_type_id: pt.id,
                    plan_key: pt.slug,
                    config_format: format,
                    config_text: configText,
                });
                inserted++;
            } catch (e) {
                failed.push(`#${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        await ctx.reply(
            `✅ ثبت گروهی انجام شد (${escapeHtml(sourceLabel)})\n` +
                `• موفق: <b>${inserted}</b>\n` +
                `• ناموفق: <b>${failed.length}</b>` +
                (failed.length
                    ? `\n\nجزئیات خطا:\n<code>${escapeHtml(failed.slice(0, 5).join('\n'))}</code>`
                    : ''),
            { parse_mode: PARSE_HTML }
        );
        await this.settingsService.setPendingStockProductType(ctx.from!.id, null);
    }

    private async fetchDocumentText(fileId: string): Promise<string> {
        const file = await this.bot.api.getFile(fileId);
        if (!file.file_path) {
            throw new Error('فایل تلگرام path ندارد.');
        }
        const token = this.env.ADMIN_BOT_TOKEN;
        if (!token) {
            throw new Error('ADMIN_BOT_TOKEN تنظیم نشده است.');
        }
        const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`دانلود فایل ناموفق بود (${response.status})`);
        }
        const bytes = await response.arrayBuffer();
        return new TextDecoder('utf-8').decode(bytes);
    }

    private async labelForInventoryRow(
        r: import('../types').AccountInventory
    ): Promise<string> {
        if (r.product_type_id) {
            const pt = await this.productTypeService.getById(r.product_type_id);
            if (pt) {
                return pt.unit === 'days'
                    ? `${pt.label_fa} (${pt.metric_value} روز)`
                    : `${pt.label_fa} (${pt.metric_value} GB)`;
            }
        }
        return this.formatPlanLabel(r.plan_key);
    }

    private registerHandlers() {
        this.bot.command('start', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) {
                await ctx.reply('دسترسی ندارید.', { parse_mode: PARSE_HTML });
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

        this.bot.command('deltype', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const text = ctx.message?.text ?? '';
            const id = parseInt(text.replace(/^\/deltype\s*/i, '').trim(), 10);
            if (!Number.isFinite(id) || id <= 0) {
                await ctx.reply('فرمت: <code>/deltype &lt;شناسه_عددی&gt;</code>', {
                    parse_mode: PARSE_HTML,
                });
                return;
            }
            await this.productTypeService.setActive(id, false);
            await ctx.reply(`نوع #${id} غیرفعال شد.`, { parse_mode: PARSE_HTML });
        });

        this.bot.command('setcard', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const text = ctx.message?.text ?? '';
            const card = text.replace(/^\/setcard\s*/i, '').trim();
            if (!/^\d{10,19}$/.test(card.replace(/\s/g, ''))) {
                await ctx.reply(
                    'فرمت: <code>/setcard 6104123456789012</code>',
                    { parse_mode: PARSE_HTML }
                );
                return;
            }
            await this.settingsService.setCardNumber(card.replace(/\s/g, ''));
            await ctx.reply('شماره کارت به‌روز شد.', { parse_mode: PARSE_HTML });
        });

        this.bot.command('setsupport', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const text = ctx.message?.text ?? '';
            const msg = text.replace(/^\/setsupport\s*/i, '').trim();
            if (!msg) {
                await ctx.reply(
                    'مثال: <code>/setsupport @کانال_ما</code> یا متن راهنما',
                    { parse_mode: PARSE_HTML }
                );
                return;
            }
            await this.settingsService.setSupportChannel(msg);
            await ctx.reply('متن پشتیبانی ذخیره شد.', { parse_mode: PARSE_HTML });
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
            let productTypeId: number | null = null;
            if (plan) {
                const pt = await this.productTypeService.getBySlugAny(plan);
                if (pt) productTypeId = pt.id;
            }

            const row = await this.inventoryService.addRow({
                username,
                password,
                plan_key: plan,
                product_type_id: productTypeId,
                config_format: format,
            });
            await ctx.reply(
                `موجودی ثبت شد — شناسه: <code>${row.id}</code> · ${escapeHtml(await this.labelForInventoryRow(row))}`,
                { parse_mode: PARSE_HTML }
            );

            const target = this.stockAnnounceChatId();
            if (target) {
                const body =
                    `✅ <b>ثبت موجودی جدید</b>\n\n` +
                    `🆔 <code>${row.id}</code>\n` +
                    `👤 <code>${escapeHtml(row.username)}</code>\n` +
                    `📦 ${escapeHtml(await this.labelForInventoryRow(row))}\n` +
                    `🔌 نوع: ${escapeHtml(this.formatFormatLabel(row.config_format ?? 'openvpn'))}`;
                try {
                    await this.bot.api.sendMessage(target, body, { parse_mode: PARSE_HTML });
                } catch (e) {
                    console.error('[ADMIN_BOT] stock channel post failed:', e);
                    await ctx.reply(
                        '⚠️ موجودی در دیتابیس ثبت شد اما ارسال به کانال موجودی ناموفق بود.',
                        { parse_mode: PARSE_HTML }
                    );
                }
            }
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
                productTypeService: this.productTypeService,
                catalogService: this.catalogService,
                bot: new Bot(this.env.BOT_TOKEN),
                payment,
                isTestMode: isTest,
                adminBotToken: this.env.ADMIN_BOT_TOKEN,
            });
            if (!r.ok) {
                await ctx.reply(`تحویل ناموفق: ${escapeHtml(r.error ?? 'نامشخص')}`, {
                    parse_mode: PARSE_HTML,
                });
                return;
            }
            await ctx.reply(
                `تحویل انجام شد — پرداخت <code>${payment.id}</code> برای تلگرام <code>${tgId}</code>`,
                { parse_mode: PARSE_HTML }
            );
        });

        this.bot.on('message:text', async (ctx) => {
            if (!canUseStockPaste(ctx, this.env)) return;
            const raw = ctx.message?.text ?? '';
            if (raw.startsWith('/')) return;

            const parsed = parseUserPassBlock(raw);
            if (!parsed) {
                const looksLikeBulk =
                    /[,;\t|]/.test(raw) ||
                    /\b(vmess|vless|trojan|ss|ssr|hysteria|hy2|tuic):\/\//i.test(raw);
                if (!looksLikeBulk) return;
                const rows = parseBulkStockRows(raw);
                if (!rows.length) return;
                await this.ingestBulkRows(ctx, rows, 'paste');
                return;
            }

            const ptId = await this.settingsService.getPendingStockProductType(ctx.from!.id);
            if (!ptId) {
                await ctx.reply(
                    'ابتدا نوع را مشخص کنید:\n' +
                        '• <b>/types</b> یا دکمه‌های شیشه‌ای\n' +
                        '• یا اینلاین: <code>@…</code> + جستجو و انتخاب نوع\n\n' +
                        'بعد بلاک User/Pass را بفرستید.',
                    { parse_mode: PARSE_HTML }
                );
                return;
            }

            const pt = await this.productTypeService.getById(ptId);
            if (!pt || !pt.is_active) {
                await this.settingsService.setPendingStockProductType(ctx.from!.id, null);
                await ctx.reply('نوع انتخاب‌شده دیگر معتبر نیست. دوباره /types را بزنید.', {
                    parse_mode: PARSE_HTML,
                });
                return;
            }

            let row;
            try {
                row = await this.inventoryService.addRow({
                    username: parsed.username,
                    password: parsed.password,
                    product_type_id: pt.id,
                    plan_key: pt.slug,
                    config_format: 'openvpn',
                });
            } catch (e) {
                await ctx.reply(
                    `خطای ثبت: ${escapeHtml(e instanceof Error ? e.message : String(e))}`,
                    { parse_mode: PARSE_HTML }
                );
                return;
            }

            const card = formatAvailableStockCard({ inv: row, productType: pt });
            await ctx.reply(card, { parse_mode: PARSE_HTML });

            try {
                await ctx.deleteMessage();
            } catch (e) {
                console.error('[ADMIN_BOT] deleteMessage failed (نیاز به ادمین بودن ربات):', e);
            }

            await this.settingsService.setPendingStockProductType(ctx.from!.id, null);
        });

        this.bot.on('message:document', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;

            const doc = ctx.message.document;
            const fileName = doc.file_name ?? '';
            const lowerName = fileName.toLowerCase();
            const mime = (doc.mime_type ?? '').toLowerCase();
            const isCsvLike =
                lowerName.endsWith('.csv') ||
                lowerName.endsWith('.txt') ||
                mime === 'text/plain' ||
                mime === 'text/csv' ||
                mime === 'application/csv' ||
                mime === 'application/vnd.ms-excel';
            const isXlsx =
                lowerName.endsWith('.xlsx') ||
                mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

            const paste = canUseStockPaste(ctx, this.env);
            const workspace = isStaffWorkspaceChannelChat(ctx, this.env);

            if (isXlsx && (paste || workspace)) {
                await ctx.reply(
                    'فایل Excel مستقیم پشتیبانی نمی‌شود. لطفاً خروجی را به CSV تبدیل کنید و دوباره بفرستید.',
                    { parse_mode: PARSE_HTML }
                );
                return;
            }

            if (paste && isCsvLike) {
                let content: string;
                try {
                    content = await this.fetchDocumentText(doc.file_id);
                } catch (e) {
                    await ctx.reply(
                        `خطای خواندن فایل: ${escapeHtml(e instanceof Error ? e.message : String(e))}`,
                        { parse_mode: PARSE_HTML }
                    );
                    return;
                }
                const rows = parseBulkStockRows(content);
                if (!rows.length) {
                    await ctx.reply(
                        'هیچ ردیف معتبری از فایل استخراج نشد. فرمت را بررسی کنید (CSV/TXT با ستون‌های user/pass/config یا لینک‌های v2ray).',
                        { parse_mode: PARSE_HTML }
                    );
                    return;
                }
                await this.ingestBulkRows(ctx, rows, fileName || 'document');
                return;
            }

            if (paste || workspace) {
                await ctx.reply(
                    `📎 <b>file_id</b> (document)\n<code>${escapeHtml(doc.file_id)}</code>`,
                    { parse_mode: PARSE_HTML }
                );
            }
        });

        this.bot.on('message:photo', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const paste = canUseStockPaste(ctx, this.env);
            const workspace = isStaffWorkspaceChannelChat(ctx, this.env);
            if (!paste && !workspace) return;

            const photos = ctx.message.photo;
            if (!photos?.length) return;
            const fileId = photos[photos.length - 1]!.file_id;
            await ctx.reply(`📎 <b>file_id</b> (photo)\n<code>${escapeHtml(fileId)}</code>`, {
                parse_mode: PARSE_HTML,
            });
        });

        this.registerInlineHandlers();
    }

    /** @BotName query در هر چت — نتایج فارسی برای تیم (نوع، قالب، راهنما). */
    private registerInlineHandlers() {
        this.bot.on('inline_query', async (ctx) => {
            const fromId = ctx.from?.id;
            if (fromId === undefined) return;

            if (!isStaffUserId(fromId, this.env)) {
                await ctx.answerInlineQuery([buildAccessDeniedArticle() as any], {
                    cache_time: 300,
                    is_personal: true,
                });
                return;
            }

            const queryRaw = ctx.inlineQuery.query;
            const qn = normalizeInlineSearch(queryRaw);

            if (qn === 'راهنما' || qn === 'help' || qn === '؟') {
                await ctx.answerInlineQuery([buildInlineHelpArticle() as any], {
                    cache_time: 60,
                    is_personal: true,
                });
                return;
            }

            if (qn === 'قالب' || qn === 'template' || qn === 'userpass') {
                await ctx.answerInlineQuery(
                    [
                        buildTemplateUserPassArticle() as any,
                        buildInlineHelpArticle() as any,
                    ],
                    { cache_time: 0, is_personal: true }
                );
                return;
            }

            const types = await this.productTypeService.listActive();
            const filtered = filterProductTypesForInline(types, queryRaw);
            const typeArticles = buildProductTypeArticles(filtered.slice(0, 40));

            const results = [
                ...typeArticles,
                buildTemplateUserPassArticle(),
                buildInlineHelpArticle(),
            ] as any[];

            await ctx.answerInlineQuery(results, {
                cache_time: 0,
                is_personal: true,
            });
        });

        this.bot.on('chosen_inline_result', async (ctx) => {
            const c = ctx.chosenInlineResult;
            if (!c) return;
            if (!isStaffUserId(c.from.id, this.env)) return;
            const rid = c.result_id;
            if (rid.startsWith('pt:')) {
                const id = parseInt(rid.slice(3), 10);
                if (Number.isFinite(id)) {
                    await this.settingsService.setPendingStockProductType(c.from.id, id);
                }
            }
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
