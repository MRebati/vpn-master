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
import { VPN_PLANS, VpnPlanKey } from '../constants';
import {
    canActAsStaff,
    canUseStockPaste,
    isStaffUserId,
    resolveTelegramChannelChatId,
} from '../utils/staffAccess';
import {
    buildAccessDeniedArticle,
    buildInlineHelpArticle,
    buildProductTypeArticles,
    buildTemplateUserPassArticle,
    filterProductTypesForInline,
    normalizeInlineSearch,
} from './adminInlineQuery';
import { escapeHtml, PARSE_HTML } from '../utils/telegramHtml';
import { parseUserPassBlock } from '../utils/parseStockCredential';
import { formatAvailableStockCard } from './stockCardMarkup';

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
            return VPN_PLANS[planKey as VpnPlanKey].name;
        }
        return planKey;
    }

    private formatFormatLabel(f: string): string {
        if (f === 'v2ray') return 'V2Ray';
        if (f === 'openvpn') return 'OpenVPN';
        return f;
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
                    '<b>ربات مدیریت VPNMasters</b>',
                    '',
                    '<b>انواع و موجودی</b>',
                    '/types — انتخاب نوع (دکمه شیشه‌ای) برای ورودی بعدی',
                    '<b>اینلاین:</b> در کانال/گروه بنویسید <code>@نام_ربات_مدیریت</code> + فاصله — لیست نوع‌ها؛ یا «راهنما»، «قالب»',
                    '/addtype — افزودن نوع (روز یا گیگ)',
                    '/deltype &lt;id&gt; — غیرفعال کردن نوع',
                    '/listtypes — لیست با شناسه (برای /deltype)',
                    '',
                    '<b>ثبت اکانت</b>',
                    '۱) /types را بزنید و نوع را انتخاب کنید',
                    '۲) بلاک زیر را بفرستید:',
                    '<code>User',
                    '…',
                    'Pass',
                    '…</code>',
                    '',
                    '<b>یا</b> دستی:',
                    '<code>/addstock user pass [slug] [openvpn|v2ray]</code>',
                    '',
                    '/stock — آمار موجودی',
                    '/stocklist — لیست',
                    '',
                    '<b>سایر</b>',
                    '/setcard، /setsupport، /deliver',
                ].join('\n'),
                { parse_mode: PARSE_HTML }
            );
        });

        this.bot.command(['types', 'picktype'], async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const types = await this.productTypeService.listActive();
            if (!types.length) {
                await ctx.reply('هنوز نوعی تعریف نشده. از /addtype استفاده کنید.', {
                    parse_mode: PARSE_HTML,
                });
                return;
            }
            const kb = new InlineKeyboard();
            types.forEach((t, i) => {
                const label =
                    t.label_fa.length > 22 ? t.label_fa.slice(0, 20) + '…' : t.label_fa;
                kb.text(label, `pt:sel:${t.id}`);
                if (i % 2 === 1) kb.row();
            });
            if (types.length % 2 === 1) kb.row();
            await ctx.reply(
                '📌 <b>نوع محصول را برای ورودی بعدی انتخاب کنید</b>\n\n' +
                    'سپس بلاک را بفرستید:\n' +
                    '<code>User</code>\n<code>نام‌کاربری</code>\n\n' +
                    '<code>Pass</code>\n<code>رمز</code>',
                { reply_markup: kb, parse_mode: PARSE_HTML }
            );
        });

        this.bot.callbackQuery(/^pt:sel:(\d+)$/, async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) {
                await ctx.answerCallbackQuery({ text: 'مجاز نیستید' });
                return;
            }
            const id = parseInt(ctx.match![1], 10);
            const pt = await this.productTypeService.getById(id);
            if (!pt || !pt.is_active) {
                await ctx.answerCallbackQuery({ text: 'نوع نامعتبر است' });
                return;
            }
            await this.settingsService.setPendingStockProductType(ctx.from!.id, id);
            await ctx.answerCallbackQuery({ text: `انتخاب: ${pt.label_fa}` });
            await ctx.reply(
                `✅ نوع فعال: <b>${escapeHtml(pt.label_fa)}</b> (<code>${escapeHtml(pt.slug)}</code>)\n\n` +
                    'اکنون بلاک User/Pass را بفرستید.',
                { parse_mode: PARSE_HTML }
            );
        });

        this.bot.command('addtype', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const text = ctx.message?.text ?? '';
            const parts = text.trim().split(/\s+/).slice(1);
            if (parts.length < 5) {
                await ctx.reply(
                    'فرمت:\n<code>/addtype slug نام_با_خط_زیر unit metric قیمت_تومان</code>\n\n' +
                        'مثال:\n<code>/addtype g50 فیفتی_گیگ gb 50 400000</code>\n' +
                        '<code>/addtype m30 یک_ماهه_ویژه days 30 150000</code>\n\n' +
                        'unit: <code>days</code> یا <code>gb</code>',
                    { parse_mode: PARSE_HTML }
                );
                return;
            }
            const [slug, labelJoined, unit, metricStr, priceStr] = parts;
            if (unit !== 'days' && unit !== 'gb') {
                await ctx.reply('unit باید days یا gb باشد.', { parse_mode: PARSE_HTML });
                return;
            }
            const metric = Number(metricStr);
            const price = parseInt(priceStr, 10);
            if (!Number.isFinite(metric) || metric <= 0 || !Number.isFinite(price)) {
                await ctx.reply('مقدار یا قیمت نامعتبر است.', { parse_mode: PARSE_HTML });
                return;
            }
            const label_fa = labelJoined.replace(/_/g, ' ');
            try {
                await this.productTypeService.create({
                    slug,
                    label_fa,
                    unit,
                    metric_value: metric,
                    price_toman: price,
                });
            } catch (e) {
                await ctx.reply(
                    `خطا: ${escapeHtml(e instanceof Error ? e.message : String(e))}`,
                    { parse_mode: PARSE_HTML }
                );
                return;
            }
            await ctx.reply(`نوع <code>${escapeHtml(slug)}</code> ثبت شد.`, {
                parse_mode: PARSE_HTML,
            });
        });

        this.bot.command('listtypes', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const types = await this.productTypeService.listAll();
            if (!types.length) {
                await ctx.reply('نوعی ثبت نشده است.', { parse_mode: PARSE_HTML });
                return;
            }
            const lines = types.map((t) => {
                const u = t.unit === 'days' ? `${t.metric_value} روز` : `${t.metric_value} GB`;
                const st = t.is_active ? '✅' : '⛔️';
                return `${st} <code>${t.id}</code> · <code>${escapeHtml(t.slug)}</code> · ${escapeHtml(t.label_fa)} · ${escapeHtml(u)} · ${t.price_toman ?? '—'} ت`;
            });
            await ctx.reply(
                `📋 <b>همه انواع</b>\n\n${lines.join('\n')}`,
                { parse_mode: PARSE_HTML }
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
                    'فرمت: <code>/addstock نام_کاربری رمز [slug_نوع] [openvpn|v2ray]</code>\n' +
                        'slug را از /types ببینید (مثلاً <code>1month</code>، <code>g50</code>)',
                    { parse_mode: PARSE_HTML }
                );
                return;
            }
            const username = rest[0];
            const password = rest[1];
            let product_type_id: number | null = null;
            let plan_key: string | null = null;
            let format = 'openvpn';

            if (rest.length >= 3) {
                const third = rest[2];
                const pt = await this.productTypeService.getActiveBySlug(third);
                if (pt) {
                    product_type_id = pt.id;
                    plan_key = pt.slug;
                    if (rest[3] === 'openvpn' || rest[3] === 'v2ray') format = rest[3];
                } else if (third === '1month' || third === '3months') {
                    plan_key = third;
                    if (rest[3] === 'openvpn' || rest[3] === 'v2ray') format = rest[3];
                } else if (third === 'openvpn' || third === 'v2ray') {
                    format = third;
                }
            }

            const row = await this.inventoryService.addRow({
                username,
                password,
                plan_key,
                product_type_id,
                config_format: format,
            });
            const ptRow = row.product_type_id
                ? await this.productTypeService.getById(row.product_type_id)
                : null;
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
            const types = await this.productTypeService.listActive();
            const lines: string[] = [];
            for (const t of types) {
                const c = await this.inventoryService.countAvailableForProductTypeId(t.id);
                const unit =
                    t.unit === 'days' ? `${t.metric_value} روز` : `${t.metric_value} GB`;
                lines.push(
                    `• ${escapeHtml(t.label_fa)} (<code>${escapeHtml(t.slug)}</code>) — ${unit}: <b>${c}</b>`
                );
            }
            const legacyAny = await this.inventoryService.countAvailable();
            const legacy1 = await this.inventoryService.countAvailable('1month');
            const legacy3 = await this.inventoryService.countAvailable('3months');
            await ctx.reply(
                `📊 <b>موجودی به تفکیک نوع</b>\n\n${lines.join('\n')}\n\n` +
                    `<i>قدیمی (بدون نوع اختصاصی):</i> کل ${legacyAny} · 1m ${legacy1} · 3m ${legacy3}`,
                { parse_mode: PARSE_HTML }
            );
        });

        this.bot.command('stocklist', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const rows = await this.inventoryService.listAvailableRows(25);
            if (!rows.length) {
                await ctx.reply('موردی در موجودی نیست.', { parse_mode: PARSE_HTML });
                return;
            }
            const lines: string[] = [];
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const plan = await this.labelForInventoryRow(r);
                const fmt = this.formatFormatLabel(r.config_format ?? 'openvpn');
                lines.push(
                    `${i + 1}. <code>${escapeHtml(r.username)}</code> — ${escapeHtml(plan)} — ${escapeHtml(fmt)}`
                );
            }
            await ctx.reply(
                `📋 <b>لیست موجودی</b> (حداکثر ۲۵)\n\n${lines.join('\n')}`,
                { parse_mode: PARSE_HTML }
            );
        });

        this.bot.command('deliver', async (ctx) => {
            if (!canActAsStaff(ctx, this.env)) return;
            const text = ctx.message?.text ?? '';
            const rest = text.replace(/^\/deliver\s*/i, '').trim().split(/\s+/);
            if (rest.length < 2) {
                await ctx.reply(
                    'فرمت: <code>/deliver &lt;telegram_user_id&gt; &lt;slug_نوع&gt;</code>\n' +
                        'مثال: <code>/deliver 123456789 1month</code>',
                    { parse_mode: PARSE_HTML }
                );
                return;
            }
            const tgId = Number(rest[0]);
            const planSlug = rest[1];
            const pt = await this.productTypeService.getActiveBySlug(planSlug);
            const legacy = planSlug === '1month' || planSlug === '3months';
            if (!pt && !legacy) {
                await ctx.reply(
                    'نوع نامعتبر. اسلاگ را از /types یا دیتابیس بگیرید.',
                    { parse_mode: PARSE_HTML }
                );
                return;
            }
            const user = await this.userService.getOrCreateUser(
                tgId,
                'Customer',
                undefined
            );
            const payment = await this.paymentService.createManualCompletedPayment(
                user.id,
                planSlug
            );
            const isTest = this.env.TEST_MODE === 'true';
            const r = await deliverInventoryForCompletedPayment({
                userService: this.userService,
                paymentService: this.paymentService,
                inventoryService: this.inventoryService,
                vpnAccountService: this.vpnAccountService,
                productTypeService: this.inventoryService.getProductTypes(),
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
            if (!parsed) return;

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
            const sent = await ctx.reply(card, { parse_mode: PARSE_HTML });
            await this.inventoryService.setStockMessageMeta(
                row.id,
                ctx.chat!.id,
                sent.message_id
            );

            try {
                await ctx.deleteMessage();
            } catch (e) {
                console.error('[ADMIN_BOT] deleteMessage failed (نیاز به ادمین بودن ربات):', e);
            }

            await this.settingsService.setPendingStockProductType(ctx.from!.id, null);
        });

        this.registerInlineHandlers();
    }

    /** @BotName query در هر چت — نتایج فارسی برای تیم (نوع، قالب، راهنما). */
    private registerInlineHandlers() {
        this.bot.on('inline_query', async (ctx) => {
            const fromId = ctx.from?.id;
            if (fromId === undefined) return;

            if (!isStaffUserId(fromId, this.env)) {
                await ctx.answerInlineQuery([buildAccessDeniedArticle()], {
                    cache_time: 300,
                    is_personal: true,
                });
                return;
            }

            const queryRaw = ctx.inlineQuery.query;
            const qn = normalizeInlineSearch(queryRaw);

            if (qn === 'راهنما' || qn === 'help' || qn === '؟') {
                await ctx.answerInlineQuery([buildInlineHelpArticle()], {
                    cache_time: 60,
                    is_personal: true,
                });
                return;
            }

            if (qn === 'قالب' || qn === 'template' || qn === 'userpass') {
                await ctx.answerInlineQuery(
                    [buildTemplateUserPassArticle(), buildInlineHelpArticle()],
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
            ];

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
