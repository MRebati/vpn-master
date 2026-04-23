import { Bot, Context, InlineKeyboard } from "grammy";
import { Menu } from "@grammyjs/menu";
import { UserService } from "../services/userService";
import { PaymentService } from "../services/paymentService";
import { VpnAccountService } from "../services/vpnAccountService";
import { SettingsService } from "../services/settingsService";
import { InventoryService } from "../services/inventoryService";
import { fulfillPaymentAfterApproval } from "../services/fulfillmentService";
import { MESSAGES, UserStep } from "../constants";
import { Env } from "../index";
import { createClient } from "@supabase/supabase-js";
import { Database, PublicPaymentMethod, PublicPlan } from "../types";
import { canActAsStaff, isStaffWorkspaceChannelChat } from "../utils/staffAccess";
import { CatalogService } from "../services/catalogService";
import { CheckoutService } from "../services/checkoutService";
import { PaymentRailFactory } from "../services/paymentRails";
import { escapeHtml, PARSE_HTML } from "../utils/telegramHtml";

// Bot context type with environment
export type BotContext = Context & { env: Env };

export class BotManager {
    private bot: Bot<BotContext>;
    private userService: UserService;
    private paymentService: PaymentService;
    private vpnAccountService: VpnAccountService;
    private settingsService: SettingsService;
    private inventoryService: InventoryService;
    private catalogService: CatalogService;
    private checkoutService: CheckoutService;
    private railFactory: PaymentRailFactory;
    private plansMenu: Menu<BotContext>;
    private mainMenu: Menu<BotContext>;
    private env: Env;
    private isInitialized = false;
    private paymentMethodContextByTelegramId = new Map<
        number,
        {
            plan: PublicPlan;
            methods: PublicPaymentMethod[];
            createdAt: number;
        }
    >();
    private tonProviderToken: string | undefined;

    private formatPaymentMethodSummary(rawCardDetails: string | null | undefined): string {
        if (!rawCardDetails) return 'ثبت نشده';
        const trimmed = rawCardDetails.trim();
        if (!trimmed) return 'ثبت نشده';
        try {
            const parsed = JSON.parse(trimmed) as {
                paymentMethodKind?: string;
                paymentMethodId?: number;
                txProof?: string;
            };
            if (parsed && typeof parsed === 'object') {
                const labelMap: Record<string, string> = {
                    rial_card: 'کارت‌به‌کارت',
                    ton: 'TON',
                    crypto: 'Crypto',
                    other: 'سایر',
                };
                const kindLabel = parsed.paymentMethodKind
                    ? (labelMap[parsed.paymentMethodKind] ?? parsed.paymentMethodKind)
                    : null;
                const txProof =
                    typeof parsed.txProof === 'string' && parsed.txProof.trim().length > 0
                        ? parsed.txProof.trim()
                        : null;
                if (kindLabel && txProof) return `${kindLabel} · TxHash: ${txProof}`;
                if (kindLabel && typeof parsed.paymentMethodId === 'number') {
                    return `${kindLabel} (ID: ${parsed.paymentMethodId})`;
                }
                if (kindLabel) return kindLabel;
                if (txProof) return `TxHash: ${txProof}`;
            }
        } catch {
            // Legacy values are plain text (e.g. last 4 digits or manual markers).
        }
        return trimmed;
    }

    private getSalesPausedMessage(): string {
        return (
            `${MESSAGES.SALES_PAUSED}\n\n` +
            `${MESSAGES.SALES_RETRY_LATER}\n` +
            `${MESSAGES.SALES_SUPPORT_HINT}`
        );
    }

    private async guardSalesEnabled(
        ctx: BotContext,
        entryPoint: string,
        userId?: number,
        userStep?: string
    ): Promise<boolean> {
        const enabled = await this.settingsService.isSalesEnabled();
        if (enabled) return true;
        const uid = userId ?? ctx.from?.id;
        console.log(
            `[SALES_GUARD] blocked purchase attempt entry=${entryPoint} user=${uid ?? 'unknown'} step=${userStep ?? 'unknown'}`
        );
        await ctx.reply(this.getSalesPausedMessage(), { parse_mode: "MarkdownV2" });
        return false;
    }

    async ensureSalesEnabledForPurchase(
        ctx: BotContext,
        entryPoint: string,
        userId?: number,
        userStep?: string
    ): Promise<boolean> {
        return this.guardSalesEnabled(ctx, entryPoint, userId, userStep);
    }

    constructor(env: Env) {
        try {
            console.log(`[BOT_INIT] Initializing bot with token: ${env.BOT_TOKEN.substring(0, 8)}...`);
            this.env = env;
            this.tonProviderToken = env.TON_PROVIDER_TOKEN;
            
            // Create bot instance
            this.bot = new Bot<BotContext>(env.BOT_TOKEN);
            
            // Inject env into context
            this.bot.use((ctx, next) => {
                ctx.env = env;
                return next();
            });
            
            // Add error handling middleware
            this.bot.use(async (ctx, next) => {
                try {
                    await next();
                } catch (err) {
                    console.error(`[BOT_MIDDLEWARE_ERROR] Error processing update:`, err);
                    
                    // Try to send an error message to the user
                    try {
                        if (ctx.chat) {
                            await ctx.reply(MESSAGES.ERROR, { parse_mode: PARSE_HTML });
                        }
                    } catch (replyErr) {
                        console.error(`[REPLY_ERROR] Failed to send error message:`, replyErr);
                    }
                }
            });
            
            // Create services
            const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_KEY;
            if (!supabaseKey) {
                throw new Error("Missing Supabase key. Set SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_KEY.");
            }
            const supabase = createClient<Database>(env.SUPABASE_URL, supabaseKey);
            console.log(`[BOT_INIT] Created Supabase client with URL: ${env.SUPABASE_URL.substring(0, 20)}...`);
            
            this.userService = new UserService(supabase);
            this.paymentService = new PaymentService(
                supabase, 
                env.ADMIN_USER_ID, 
                env.CARD_NUMBER,
                this.bot,  // Pass the bot instance to allow sending messages
                env.CHANNEL_ID // Pass the channel ID
            );
            this.vpnAccountService = new VpnAccountService(supabase);
            this.settingsService = new SettingsService(supabase, {
                salesFailClosed: env.SALES_FAIL_CLOSED === 'true',
            });
            this.inventoryService = new InventoryService(supabase);
            this.catalogService = new CatalogService(supabase);
            this.railFactory = new PaymentRailFactory();
            this.checkoutService = new CheckoutService(
                this.catalogService,
                this.paymentService,
                this.railFactory
            );
            
            // Create and register menus
            console.log(`[BOT_INIT] Creating bot menus`);
            try {
                const { plansMenu, mainMenu } = this.createMenus();
                this.plansMenu = plansMenu;
                this.mainMenu = mainMenu;
                
                this.bot.use(plansMenu);
                this.bot.use(mainMenu);
            } catch (menuError) {
                console.error(`[BOT_INIT_ERROR] Failed to create menus:`, menuError);
                // Create fallback menus if possible
                this.createFallbackMenus();
            }
            
            // Register handlers
            console.log(`[BOT_INIT] Registering command handlers`);
            this.registerCommandHandlers();
            this.registerCallbackHandlers();
            this.registerMediaHandlers();
            this.registerMessageHandler();
            
            console.log(`[BOT_INIT] Bot initialization complete`);
        } catch (error) {
            console.error(`[BOT_INIT_ERROR] Failed to initialize bot:`, error);
            throw error;
        }
    }
    
    /**
     * Create fallback menus in case the main menu creation fails
     */
    private createFallbackMenus() {
        console.log(`[BOT_INIT] Creating fallback menus`);
        
        // Simple fallback menus with minimal functionality
        this.plansMenu = new Menu<BotContext>("plans-menu-fallback")
            .text("یک ماهه", async (ctx) => {
                await ctx.reply(MESSAGES.ERROR + "\n\n🔧 حالت آزمایشی فعال است", {
                    parse_mode: PARSE_HTML,
                });
            })
            .row()
            .text("سه ماهه", async (ctx) => {
                await ctx.reply(MESSAGES.ERROR + "\n\n🔧 حالت آزمایشی فعال است", {
                    parse_mode: PARSE_HTML,
                });
            });
            
        this.mainMenu = new Menu<BotContext>("main-menu-fallback")
            .text("🛍 خرید اشتراک", async (ctx) => {
                await ctx.reply(MESSAGES.ERROR + "\n\n🔧 حالت آزمایشی فعال است", {
                    parse_mode: PARSE_HTML,
                });
            })
            .row()
            .text("❓ راهنما", async (ctx) => {
                await ctx.reply(MESSAGES.HELP, { parse_mode: PARSE_HTML });
            });
            
        this.bot.use(this.plansMenu);
        this.bot.use(this.mainMenu);
    }
    
    /**
     * Initialize the bot (must be called before processing updates)
     */
    async init() {
        try {
            if (!this.isInitialized) {
                console.log(`[BOT_INIT] Initializing bot instance`);
                await this.bot.init();
                this.isInitialized = true;
                console.log(`[BOT_INIT] Bot initialization successful`);
            }
        } catch (error) {
            console.error(`[BOT_INIT_ERROR] Failed to initialize bot:`, error);
            this.isInitialized = false; // Mark as not initialized so we can try again
            throw error;
        }
    }

    private escapeMdV2(value: string): string {
        return value.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
    }

    private formatPlanLine(plan: PublicPlan): string {
        const price = `${plan.priceToman.toLocaleString()} تومان`;
        const metric = plan.unit === "days" ? `${plan.metricValue} روز` : `${plan.metricValue} گیگ`;
        const rating = typeof plan.rating === "number" ? `⭐️ امتیاز: ${plan.rating}\n` : "";
        return (
            `📦 ${plan.title}\n` +
            `📏 ${metric}\n` +
            `💰 ${price}\n` +
            rating +
            `${plan.guidelineText ? `📝 ${plan.guidelineText}\n` : ""}`
        ).trim();
    }

    private async showPlanSelection(ctx: BotContext): Promise<void> {
        const plans = (await this.checkoutService.listPlans()).filter(
            (p) => p.isCatalogVisible
        );
        if (!plans.length) {
            await ctx.reply("در حال حاضر پلن فعالی برای نمایش وجود ندارد. لطفاً بعداً دوباره تلاش کنید.");
            return;
        }

        const keyboard = new InlineKeyboard();
        plans.forEach((plan, index) => {
            const rating =
                plan.rating !== null && plan.rating !== undefined
                    ? ` ⭐️${plan.rating.toFixed(1)}`
                    : "";
            keyboard.text(`${plan.title}${rating}`, `plan:${encodeURIComponent(plan.slug)}`);
            if (index < plans.length - 1) keyboard.row();
        });

        const lines = plans.map(
            (p, idx) =>
                `${idx + 1}. ${p.title} — ${p.priceToman.toLocaleString()} تومان${
                    p.rating !== null && p.rating !== undefined
                        ? ` (⭐️ ${p.rating.toFixed(1)})`
                        : ""
                }`
        );
        await ctx.reply(
            "📱 پلن‌های فعال:\n\n" + lines.join("\n") + "\n\nیک پلن را انتخاب کنید:",
            { reply_markup: keyboard }
        );
    }

    private async showPaymentMethodSelection(
        ctx: BotContext,
        plan: PublicPlan,
        methods: PublicPaymentMethod[]
    ): Promise<void> {
        const keyboard = new InlineKeyboard();
        methods.forEach((method, index) => {
            keyboard.text(method.label, `select_method:${method.id}`);
            if (index < methods.length - 1) keyboard.row();
        });

        const planDetails = this.formatPlanLine(plan)
            .split("\n")
            .map((line) => this.escapeMdV2(line))
            .join("\n");
        await ctx.reply(`✅ *پلن انتخاب شد*\n\n${planDetails}\n\nروش پرداخت را انتخاب کنید:`, {
            parse_mode: "MarkdownV2",
            reply_markup: keyboard,
        });
    }

    private async recoverPaymentMethodSession(
        ctx: BotContext
    ): Promise<
        | {
              plan: PublicPlan;
              methods: PublicPaymentMethod[];
              createdAt: number;
          }
        | null
    > {
        const cached = this.paymentMethodContextByTelegramId.get(ctx.from.id);
        if (cached && Date.now() - cached.createdAt <= 20 * 60_000) return cached;

        const user = await this.userService.getOrCreateUser(
            ctx.from.id,
            ctx.from.first_name,
            ctx.from.username
        );
        if (!user.selected_plan) return null;
        const plan = await this.catalogService.getPlanByInternalPlanKey(user.selected_plan);
        if (!plan || !plan.isCatalogVisible) return null;
        const methods = await this.checkoutService.listPaymentMethodsForPlan(plan);
        const recovered = {
            plan,
            methods,
            createdAt: Date.now(),
        };
        this.paymentMethodContextByTelegramId.set(ctx.from.id, recovered);
        return recovered;
    }

    private async sendTonInvoice(
        ctx: BotContext,
        input: {
            plan: PublicPlan;
            method: PublicPaymentMethod;
            paymentId: number;
            transactionId: string;
            amountToman: number;
        }
    ): Promise<void> {
        if (!this.tonProviderToken) {
            await ctx.reply(
                "درگاه پرداخت TON موقتاً در دسترس نیست. لطفاً روش پرداخت دیگری انتخاب کنید."
            );
            return;
        }
        const payload = `ton:${input.paymentId}:${input.transactionId}`;
        await this.bot.api.sendInvoice(
            ctx.from.id,
            `اشتراک VPN - ${input.plan.title}`,
            `پرداخت Telegram Stars برای پلن ${input.plan.title}\nشناسه: ${input.transactionId}`,
            payload,
            "XTR",
            [{ label: `پلن ${input.plan.title}`, amount: Math.max(1, Math.round(input.amountToman)) }],
            {
                provider_token: this.tonProviderToken,
            }
        );
        await ctx.reply("پس از پرداخت موفق در تلگرام، اشتراک شما به‌صورت خودکار تحویل می‌شود.");
    }

    private async handlePlanSelection(ctx: BotContext, slug: string): Promise<void> {
        const plan = await this.checkoutService.getPlanBySlug(slug);
        if (!plan || !plan.isCatalogVisible) {
            await ctx.reply("این پلن در حال حاضر قابل خرید نیست. لطفاً از پلن‌های فعال انتخاب کنید.");
            return;
        }

        const user = await this.userService.getOrCreateUser(
            ctx.from.id,
            ctx.from.first_name,
            ctx.from.username
        );
        await this.userService.selectPlan(user.id, plan.internalPlanKey, plan.priceToman);
        await this.userService.setUserStep(user.id, UserStep.AWAITING_PAYMENT_METHOD);

        const methods = await this.checkoutService.listPaymentMethodsForPlan(plan);
        this.paymentMethodContextByTelegramId.set(ctx.from.id, {
            plan,
            methods,
            createdAt: Date.now(),
        });

        await this.showPaymentMethodSelection(ctx, plan, methods);
    }

    private async showOrderStatus(ctx: BotContext, dbUserId: number): Promise<void> {
        const latest = await this.paymentService.getLatestOrderStatus(dbUserId);
        if (!latest) {
            await ctx.reply("سفارشی برای شما ثبت نشده است.");
            return;
        }

        const statusLabel =
            latest.status === "COMPLETED"
                ? "تکمیل‌شده"
                : latest.status === "FAILED"
                  ? "ناموفق"
                  : latest.status === "EXPIRED"
                    ? "منقضی"
                    : "در انتظار";
        const reviewLabel =
            latest.reviewStatus === "approved"
                ? "تایید شده"
                : latest.reviewStatus === "rejected"
                  ? "رد شده"
                  : "در حال بررسی";

        await ctx.reply(
            `📦 وضعیت آخرین سفارش\n\n` +
                `🆔 شماره پرداخت: ${latest.paymentId}\n` +
                `💳 وضعیت پرداخت: ${statusLabel}\n` +
                `🧾 وضعیت بررسی: ${reviewLabel}\n` +
                `⏱ بروزرسانی: ${new Date(latest.updatedAt).toLocaleString("fa-IR")}`
        );
    }
    
    /**
     * Create menu objects
     */
    private createMenus() {
        // Plans menu
        const plansMenu = new Menu<BotContext>("plans-menu")
            .text("🔄 نمایش پلن‌های فعال", async (ctx) => {
                if (!(await this.ensureSalesEnabledForPurchase(ctx, "show-plans-menu"))) return;
                await this.showPlanSelection(ctx);
            });

        // Main menu
        const mainMenu = new Menu<BotContext>("main-menu")
            .text("🛍 خرید اشتراک", async (ctx) => {
                if (!(await this.ensureSalesEnabledForPurchase(ctx, "purchase-main-menu"))) return;
                const user = await this.userService.getOrCreateUser(
                    ctx.from.id,
                    ctx.from.first_name,
                    ctx.from.username
                );
                await this.userService.setUserStep(user.id, UserStep.SELECTING_PLAN);
                await this.showPlanSelection(ctx);
            })
            .row()
            .text("📋 اکانت‌های من", async (ctx) => {
                const user = await this.userService.getOrCreateUser(
                    ctx.from.id,
                    ctx.from.first_name,
                    ctx.from.username
                );
                const accounts = await this.vpnAccountService.listAccountsForUser(user.id);
                if (!accounts.length) {
                    await ctx.reply("هنوز اکانتی برای شما ثبت نشده است.");
                    return;
                }
                const lines = accounts.map(
                    (a, i) => `${i + 1}. ${a.username}`
                );
                await ctx.reply("📋 اکانت‌های شما:\n\n" + lines.join("\n"));
            })
            .row()
            .text("📦 وضعیت سفارش", async (ctx) => {
                const user = await this.userService.getOrCreateUser(
                    ctx.from.id,
                    ctx.from.first_name,
                    ctx.from.username
                );
                await this.showOrderStatus(ctx, user.id);
            })
            .row()
            .text("❓ راهنما", async (ctx) => {
                console.log(`[HELP] Showing help to user ${ctx.from.id} (${ctx.from.first_name})`);
                await ctx.reply(MESSAGES.HELP, { parse_mode: PARSE_HTML });
            })
            .row()
            .text("📞 پشتیبانی", async (ctx) => {
                console.log(`[SUPPORT] Showing support info to user ${ctx.from.id} (${ctx.from.first_name})`);
                const text = await this.settingsService.getSupportChannel(MESSAGES.SUPPORT);
                await ctx.reply(text, { parse_mode: PARSE_HTML });
            });
            
        return { plansMenu, mainMenu };
    }
    
    /**
     * Register command handlers
     */
    private registerCommandHandlers() {
        // Handle /start command
        this.bot.command("start", async (ctx) => {
            try {
                console.log(`[COMMAND] /start received from user ${ctx.from.id} (${ctx.from.first_name})`);
                
                try {
                    // Get or create user
                    console.log(`[DB_OPERATION] Attempting to get or create user for ${ctx.from.id}`);
                    const user = await this.userService.getOrCreateUser(
                        ctx.from.id,
                        ctx.from.first_name,
                        ctx.from.username
                    );
                    console.log(`[DB_OPERATION] Successfully got or created user: ${JSON.stringify(user)}`);
                    
                    // Show welcome message with main menu
                    console.log(`[REPLY] Sending welcome message with main menu to user ${ctx.from.id}`);
                    await ctx.reply(MESSAGES.WELCOME, {
                        reply_markup: this.mainMenu,
                        parse_mode: PARSE_HTML,
                    });
                    console.log(`[REPLY] Welcome message sent successfully to user ${ctx.from.id}`);
                } catch (dbError) {
                    console.error(`[DB_ERROR] Error in database operation during /start command:`, dbError);
                    
                    // In test mode, we can proceed even without database connection
                    const isTestMode = this.env.TEST_MODE === 'true';
                    if (isTestMode) {
                        console.log(`[TEST_MODE] Continuing in test mode despite database error`);
                        await ctx.reply(MESSAGES.WELCOME + "\n\n🔧 حالت آزمایشی فعال است", {
                            reply_markup: this.mainMenu,
                            parse_mode: PARSE_HTML,
                        });
                    } else {
                        throw dbError; // Re-throw to be caught by the outer catch block
                    }
                }
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /start command:`, error);
                
                // Send a more friendly error message to the user
                const errDetail = error instanceof Error ? escapeHtml(error.message) : 'خطای ناشناخته';
                const errorMsg = `${MESSAGES.ERROR}\n\nکد خطا: ${errDetail}`;
                await ctx.reply(errorMsg, { parse_mode: PARSE_HTML });

                // Notify channel about the error if possible
                try {
                    const adminErrorMsg =
                        `⚠️ <b>خطای مدیریتی</b>\n\n` +
                        `❌ <code>${escapeHtml(String(error instanceof Error ? error.message : 'خطای ناشناخته'))}</code>\n` +
                        `⏱️ زمان: ${escapeHtml(new Date().toISOString())}`;
                    const channelId = this.env.CHANNEL_ID ? `-100${this.env.CHANNEL_ID}` : null;

                    if (channelId) {
                        await this.bot.api.sendMessage(channelId, adminErrorMsg, { parse_mode: PARSE_HTML });
                        console.log(`[CHANNEL_NOTIFY] Admin error notification sent to channel ${channelId}`);
                    } else {
                        // Fallback to admin user
                        await this.bot.api.sendMessage(this.env.ADMIN_USER_ID, adminErrorMsg, { parse_mode: PARSE_HTML });
                        console.log(`[ADMIN_NOTIFY] Admin error notification sent to admin user`);
                    }
                } catch (notifyError) {
                    console.error(`[CHANNEL_NOTIFY_ERROR] Failed to notify about admin error:`, notifyError);
                }
            }
        });
        
        // Handle /help command
        this.bot.command("help", async (ctx) => {
            try {
                console.log(`[COMMAND] /help from ${ctx.from.first_name} (${ctx.from.id})`);
                await ctx.replyWithPhoto(
                    'https://vpn-master-bot.m-rebati.workers.dev/images/help.jpg',
                    { caption: MESSAGES.HELP, parse_mode: PARSE_HTML }
                );
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /help command:`, error);
            }
        });

        this.bot.command("order_status", async (ctx) => {
            try {
                const user = await this.userService.getOrCreateUser(
                    ctx.from.id,
                    ctx.from.first_name,
                    ctx.from.username
                );
                await this.showOrderStatus(ctx, user.id);
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /order_status command:`, error);
                await ctx.reply(MESSAGES.ERROR, { parse_mode: "MarkdownV2" });
            }
        });
        
        // Add a channel test command
        this.bot.command("channel_test", async (ctx) => {
            try {
                // Only allow the admin to use this command
                if (ctx.from.id.toString() !== this.env.ADMIN_USER_ID) {
                    await ctx.reply("⚠️ This command is for admin use only.");
                    return;
                }

                console.log(`[COMMAND] /channel_test from admin ${ctx.from.first_name} (${ctx.from.id})`);
                await ctx.reply("Starting channel notification test...");

                const testMessage = `🧪 <b>CHANNEL TEST MESSAGE</b>\n\nThis is a test message to verify channel communication.\nTime: ${new Date().toISOString()}\nSent by: ${ctx.from.first_name}`;

                // Try multiple channel ID formats
                const channelIdFromEnv = this.env.CHANNEL_ID || '2546220251';
                await ctx.reply(`Attempt 1: Trying with ID format: -100${channelIdFromEnv}`);
                try {
                    await this.bot.api.sendMessage(`-100${channelIdFromEnv}`, testMessage, { parse_mode: PARSE_HTML });
                    await ctx.reply(`✅ Success! Message sent to channel with ID: -100${channelIdFromEnv}`);
                } catch (error) {
                    await ctx.reply(`❌ Failed: ${error.message}`);
                
                    await ctx.reply("Attempt 2: Trying with username format: @VPNMasters_Support");
                    try {
                        await this.bot.api.sendMessage('@VPNMasters_Support', testMessage, { parse_mode: PARSE_HTML });
                        await ctx.reply("✅ Success! Message sent to channel with username: @VPNMasters_Support");
                    } catch (error2) {
                        await ctx.reply(`❌ Failed: ${error2.message}`);
                    
                        await ctx.reply(`Attempt 3: Trying with numeric ID only: ${channelIdFromEnv}`);
                        try {
                            await this.bot.api.sendMessage(channelIdFromEnv, testMessage, { parse_mode: PARSE_HTML });
                            await ctx.reply(`✅ Success! Message sent to channel with ID: ${channelIdFromEnv}`);
                        } catch (error3) {
                            await ctx.reply(`❌ Failed: ${error3.message}`);
                            
                            await ctx.reply("Attempt 4: Trying with supergroupID (-100) format");
                            try {
                                await this.bot.api.sendMessage('-100' + channelIdFromEnv, testMessage, { parse_mode: PARSE_HTML });
                                await ctx.reply(`✅ Success! Message sent with ID: -100${channelIdFromEnv}`);
                            } catch (error4) {
                                await ctx.reply(`❌ Failed: ${error4.message}`);

                                await ctx.reply("❌ All channel test attempts failed. Please check channel ID, permissions, and that the bot is a member of the channel with posting rights.");
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /channel_test command:`, error);
                await ctx.reply(`Error in channel test: ${error.message}`);
            }
        });
        
        // Add a /test command for diagnostics
        this.bot.command("test", async (ctx) => {
            try {
                console.log(`[COMMAND] /test from ${ctx.from.first_name} (${ctx.from.id})`);
                
                // Test basic functionality
                const testResults = [
                    `🤖 Bot is running`,
                    `👤 User ID: ${ctx.from.id}`,
                    `📡 Test mode: ${this.env.TEST_MODE === 'true' ? 'Enabled' : 'Disabled'}`,
                    `⏱️ Current time: ${new Date().toISOString()}`
                ];
                
                // Test Supabase connection
                try {
                    const supabase = createClient<Database>(this.env.SUPABASE_URL, this.env.SUPABASE_KEY);
                    const { count, error } = await supabase
                        .from('vpn_users')
                        .select('*', { count: 'exact', head: true });
                    
                    if (error) {
                        testResults.push(`❌ Database connection error: ${error.message}`);
                    } else {
                        testResults.push(`✅ Database connection successful (${count} users in database)`);
                    }
                } catch (dbError) {
                    testResults.push(`❌ Database error: ${dbError.message}`);
                }
                
                await ctx.reply(testResults.join('\n'));
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /test command:`, error);
                await ctx.reply(`${MESSAGES.ERROR}\n\nTest command error: ${error.message}`);
            }
        });
        
        // Add a command to check webhook status
        this.bot.command("checkwebhook", async (ctx) => {
            try {
                console.log(`[COMMAND] /checkwebhook from ${ctx.from.first_name} (${ctx.from.id})`);
                
                // Only allow the admin to use this command
                if (ctx.from.id.toString() !== this.env.ADMIN_USER_ID) {
                    await ctx.reply("⚠️ This command is only available to the admin.");
                    return;
                }
                
                const webhookInfo = await this.getWebhookInfo();
                
                if (webhookInfo) {
                    const message =
                        `🔗 <b>Webhook Information</b>\n\n` +
                        `URL: ${webhookInfo.url ? escapeHtml(webhookInfo.url) : 'Not set'}\n` +
                        `Has Custom Certificate: ${webhookInfo.has_custom_certificate ? 'Yes' : 'No'}\n` +
                        `Pending Updates: ${webhookInfo.pending_update_count}\n` +
                        `Last Error Date: ${webhookInfo.last_error_date ? escapeHtml(new Date(webhookInfo.last_error_date * 1000).toISOString()) : 'None'}\n` +
                        `Last Error Message: ${webhookInfo.last_error_message ? escapeHtml(webhookInfo.last_error_message) : 'None'}\n` +
                        `Max Connections: ${webhookInfo.max_connections}`;

                    await ctx.reply(message, { parse_mode: PARSE_HTML });
                } else {
                    await ctx.reply("❌ Failed to get webhook information.");
                }
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /checkwebhook command:`, error);
                await ctx.reply(
                    `${MESSAGES.ERROR}\n\nWebhook check error: ${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}`,
                    { parse_mode: PARSE_HTML }
                );
            }
        });
        
        // Add a command to set webhook URL
        this.bot.command("setwebhook", async (ctx) => {
            try {
                console.log(`[COMMAND] /setwebhook from ${ctx.from.first_name} (${ctx.from.id})`);
                
                // Only allow the admin to use this command
                if (ctx.from.id.toString() !== this.env.ADMIN_USER_ID) {
                    await ctx.reply("⚠️ This command is only available to the admin.");
                    return;
                }
                
                // Get the URL from the command arguments
                const args = ctx.message.text.split(' ');
                if (args.length < 2) {
                    await ctx.reply("⚠️ Please provide a webhook URL: /setwebhook https://your-domain.com");
                    return;
                }
                
                const url = args[1];
                if (!url.startsWith('https://')) {
                    await ctx.reply("⚠️ Webhook URL must start with https://");
                    return;
                }
                
                const success = await this.setupWebhook(url);
                
                if (success) {
                    await ctx.reply(`✅ Successfully set webhook to ${url}`);
                } else {
                    await ctx.reply("❌ Failed to set webhook. Check server logs for details.");
                }
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /setwebhook command:`, error);
                await ctx.reply(
                    `${MESSAGES.ERROR}\n\nWebhook set error: ${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}`,
                    { parse_mode: PARSE_HTML }
                );
            }
        });

        // Add command to look up payment by transaction ID
        this.bot.command("payment", async (ctx) => {
            try {
                console.log(`[COMMAND] /payment from ${ctx.from.first_name} (${ctx.from.id})`);
                
                // Only allow the admin to use this command
                if (ctx.from.id.toString() !== this.env.ADMIN_USER_ID) {
                    await ctx.reply("⚠️ This command is only available to the admin.");
                    return;
                }
                
                // Check if a transaction ID was provided
                const params = ctx.message.text.split(' ').slice(1);
                if (params.length === 0) {
                    await ctx.reply("⚠️ Please provide a transaction ID: /payment <transaction_id>");
                    return;
                }
                
                const transactionId = params[0];
                console.log(`[PAYMENT_LOOKUP] Looking up payment with transaction ID: ${transactionId}`);
                
                // Fetch the payment
                const payment = await this.paymentService.getPaymentByTransactionId(transactionId);
                
                if (!payment) {
                    await ctx.reply(`❌ No payment found with transaction ID: ${transactionId}`);
                    return;
                }
                
                // Get user info
                const user = await this.userService.getUserById(payment.user_id);
                
                const message =
                    `💳 <b>Payment Details</b>\n` +
                    `🆔 Transaction ID: <code>${escapeHtml(payment.transaction_id)}</code>\n` +
                    `👤 User: ${user ? `${escapeHtml(user.first_name)} (ID: ${user.id})` : `User ID: ${payment.user_id}`}\n` +
                    `💰 Amount: ${escapeHtml(String(payment.amount))} تومان\n` +
                    `📅 Plan: ${escapeHtml(payment.plan)}\n` +
                    `📊 Status: <b>${escapeHtml(payment.status.toUpperCase())}</b>\n` +
                    `💳 Payment Method: ${escapeHtml(this.formatPaymentMethodSummary(payment.card_last_digits ?? null))}\n` +
                    `📆 Created: ${escapeHtml(new Date(payment.created_at).toLocaleString('fa-IR'))}\n` +
                    `📆 Updated: ${escapeHtml(new Date(payment.updated_at).toLocaleString('fa-IR'))}`;

                await ctx.reply(message, { parse_mode: PARSE_HTML });
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /payment command:`, error);
                await ctx.reply(
                    `${MESSAGES.ERROR}\n\nError: ${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}`,
                    { parse_mode: PARSE_HTML }
                );
            }
        });

        // Add a command to check channel information
        this.bot.command("check_channel", async (ctx) => {
            try {
                // Only allow admin to use this command
                if (ctx.from.id.toString() !== this.env.ADMIN_USER_ID) {
                    await ctx.reply("⚠️ This command is for admin use only.");
                    return;
                }
                
                console.log(`[COMMAND] /check_channel from admin ${ctx.from.first_name} (${ctx.from.id})`);
                await ctx.reply("🔍 Checking channel information...");

                // First, try to get the chat
                const channelIdFromEnv = this.env.CHANNEL_ID || '2546220251';
                try {
                    await ctx.reply(`Attempt to get info for: -100${channelIdFromEnv}`);
                    const chatInfo = await this.bot.api.getChat(`-100${channelIdFromEnv}`);
                    await ctx.reply(
                        `✅ Channel found!\n` +
                        `ID: ${chatInfo.id}\n` +
                        `Type: ${chatInfo.type}\n` +
                        `Title: ${chatInfo.title}`
                    );
                } catch (error) {
                    await ctx.reply(`❌ Failed: ${error.message}`);
                    
                    // Try with other formats
                    try {
                        await ctx.reply("Attempt to get info for: @VPNMasters_Support");
                        const chatInfo = await this.bot.api.getChat('@VPNMasters_Support');
                        await ctx.reply(
                            `✅ Channel found with username!\n` +
                            `ID: ${chatInfo.id}\n` +
                            `Type: ${chatInfo.type}\n` +
                            `Title: ${chatInfo.title}`
                        );
                    } catch (error2) {
                        await ctx.reply(`❌ Failed: ${error2.message}`);
                    }
                }
                
                // Advise about required permissions
                await ctx.reply(
                    "⚠️ For notifications to work:\n" +
                    "1. The bot must be a member of the channel\n" +
                    "2. The bot must have permission to post messages\n" +
                    "3. The channel ID format must be correct"
                );
                
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /check_channel command:`, error);
                await ctx.reply(
                    `Error in channel check: ${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}`,
                    { parse_mode: PARSE_HTML }
                );
            }
        });
    }
    
    private registerCallbackHandlers() {
        this.bot.callbackQuery(/^plan:(.+)$/, async (ctx) => {
            await ctx.answerCallbackQuery();
            if (!(await this.ensureSalesEnabledForPurchase(ctx, 'plan-callback'))) return;
            const rawSlug = ctx.match![1];
            const slug = decodeURIComponent(rawSlug);
            await this.handlePlanSelection(ctx, slug);
        });

        this.bot.callbackQuery(/^select_method:(\d+)$/, async (ctx) => {
            await ctx.answerCallbackQuery();
            if (!(await this.ensureSalesEnabledForPurchase(ctx, 'payment-method-callback'))) return;
            const methodId = Number(ctx.match![1]);
            const session = await this.recoverPaymentMethodSession(ctx);
            if (!session || Date.now() - session.createdAt > 20 * 60_000) {
                await ctx.reply("جلسه خرید منقضی شده است. لطفاً دوباره /start را بزنید.");
                return;
            }
            const method = session.methods.find((m) => m.id === methodId);
            if (!method) {
                await ctx.reply("روش پرداخت انتخابی معتبر نیست.");
                return;
            }

            const user = await this.userService.getOrCreateUser(
                ctx.from.id,
                ctx.from.first_name,
                ctx.from.username
            );
            const checkout = await this.checkoutService.createPaymentAndInstruction({
                userId: user.id,
                telegramUserId: ctx.from.id,
                plan: session.plan,
                method,
            });
            if (method.kind === "ton") {
                await this.userService.setUserStep(user.id, UserStep.AWAITING_PAYMENT);
            } else {
                await this.userService.setUserStep(user.id, UserStep.AWAITING_PAYMENT_PROOF);
            }

            await ctx.reply(
                `📋 پلن انتخابی: ${session.plan.title}\n💲 مبلغ قابل پرداخت: ${checkout.amount.toLocaleString()} تومان`
            );
            if (method.kind === "ton") {
                await this.sendTonInvoice(ctx, {
                    plan: session.plan,
                    method,
                    paymentId: checkout.paymentId,
                    transactionId: checkout.transactionId,
                    amountToman: checkout.amount,
                });
            } else {
                const railNote = method.instructions ? `\n\n${method.instructions}` : "";
                await ctx.reply(`${checkout.instruction.instructionText}${railNote}`, {
                    parse_mode: PARSE_HTML,
                });
                if (checkout.instruction.deepLink) {
                    await ctx.reply(`🔗 لینک پرداخت:\n${checkout.instruction.deepLink}`);
                }
            }
        });

        this.bot.callbackQuery(/^ap:(\d+)$/, async (ctx) => {
            if (!ctx.from || !canActAsStaff(ctx, this.env)) {
                await ctx.answerCallbackQuery({ text: "مجاز نیستید" });
                return;
            }
            await ctx.answerCallbackQuery();
            const paymentId = parseInt(ctx.match![1], 10);
            const result = await fulfillPaymentAfterApproval({
                userService: this.userService,
                paymentService: this.paymentService,
                inventoryService: this.inventoryService,
                vpnAccountService: this.vpnAccountService,
                productTypeService: this.inventoryService.getProductTypes(),
                catalogService: this.catalogService,
                bot: this.bot,
                paymentId,
                isTestMode: this.env.TEST_MODE === "true",
                adminBotToken: this.env.ADMIN_BOT_TOKEN,
            });
            if (!result.ok) {
                await ctx.reply(`خطا: ${result.error ?? "نامشخص"}`);
            } else {
                await ctx.reply("تایید شد و اکانت برای کاربر ارسال شد.");
            }
        });

        this.bot.callbackQuery(/^rj:(\d+)$/, async (ctx) => {
            if (!ctx.from || !canActAsStaff(ctx, this.env)) {
                await ctx.answerCallbackQuery({ text: "مجاز نیستید" });
                return;
            }
            await ctx.answerCallbackQuery();
            const paymentId = parseInt(ctx.match![1], 10);
            await this.paymentService.updatePaymentStatus(paymentId, "FAILED");
            await this.paymentService.setReviewStatus(paymentId, "rejected");
            const p = await this.paymentService.getPaymentById(paymentId);
            if (p) {
                const u = await this.userService.getUserById(p.user_id);
                if (u) {
                    try {
                        await this.bot.api.sendMessage(
                            u.telegram_id,
                            "پرداخت شما توسط پشتیبان رد شد. در صورت نیاز تماس بگیرید."
                        );
                    } catch (e) {
                        console.error("[REJECT_NOTIFY_USER]", e);
                    }
                }
            }
            await ctx.reply("پرداخت رد شد.");
        });
    }

    private registerMediaHandlers() {
        const replyChannelFileId = async (ctx: BotContext, label: string, fileId: string) => {
            if (!canActAsStaff(ctx, this.env)) return;
            if (!isStaffWorkspaceChannelChat(ctx, this.env)) return;
            await ctx.reply(`📎 <b>file_id</b> (${label})\n<code>${escapeHtml(fileId)}</code>`, {
                parse_mode: PARSE_HTML,
            });
        };

        this.bot.on("channel_post:document", async (ctx) => {
            const doc = ctx.channelPost?.document;
            if (!doc) return;
            const fileName = doc.file_name ?? '';
            const lowerName = fileName.toLowerCase();
            const mime = (doc.mime_type ?? '').toLowerCase();
            const isXlsx =
                lowerName.endsWith('.xlsx') ||
                mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            if (
                isXlsx &&
                canActAsStaff(ctx, this.env) &&
                isStaffWorkspaceChannelChat(ctx, this.env)
            ) {
                await ctx.reply(
                    'فایل Excel مستقیم پشتیبانی نمی‌شود. لطفاً خروجی را به CSV تبدیل کنید و دوباره بفرستید.',
                    { parse_mode: PARSE_HTML }
                );
                return;
            }
            await replyChannelFileId(ctx, 'document', doc.file_id);
        });

        this.bot.on("channel_post:photo", async (ctx) => {
            const photos = ctx.channelPost?.photo;
            if (!photos?.length) return;
            const fileId = photos[photos.length - 1]!.file_id;
            await replyChannelFileId(ctx, 'photo', fileId);
        });

        this.bot.on(["message:photo", "message:document"], async (ctx) => {
            try {
                const user = await this.userService.getOrCreateUser(
                    ctx.from.id,
                    ctx.from.first_name,
                    ctx.from.username
                );
                if (
                    user.step !== UserStep.AWAITING_PAYMENT &&
                    user.step !== UserStep.AWAITING_PAYMENT_PROOF
                ) {
                    return;
                }
                if (
                    !(await this.ensureSalesEnabledForPurchase(
                        ctx,
                        "proof-submission",
                        user.id,
                        user.step
                    ))
                ) {
                    return;
                }

                const pending = await this.paymentService.getLatestPendingPayment(user.id);
                if (!pending) return;

                let fileId: string;
                let proofType: "photo" | "document";
                if (ctx.message.photo?.length) {
                    fileId = ctx.message.photo[ctx.message.photo.length - 1]!.file_id;
                    proofType = "photo";
                } else if (ctx.message.document) {
                    fileId = ctx.message.document.file_id;
                    proofType = "document";
                } else {
                    return;
                }

                await this.paymentService.recordProof(pending.id, fileId, proofType);
                await ctx.reply(MESSAGES.PAYMENT_RECEIVED, { parse_mode: PARSE_HTML });

                const channelId = this.env.CHANNEL_ID ? `-100${this.env.CHANNEL_ID}` : null;
                if (!channelId) return;

                const captionHtml =
                    `🔔 <b>رسید پرداخت</b>\n\n` +
                    `👤 ${escapeHtml(ctx.from.first_name || "")}\n` +
                    `💰 ${escapeHtml(pending.amount.toLocaleString())} تومان\n` +
                    `🧾 <code>${escapeHtml(pending.transaction_id)}</code> · payment #${pending.id}\n` +
                    `📎 File ID: <code>${escapeHtml(fileId)}</code>`;

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: "✅ تایید", callback_data: `ap:${pending.id}` },
                            { text: "❌ رد", callback_data: `rj:${pending.id}` },
                        ],
                    ],
                };

                const fromChatId = ctx.chat?.id;
                const messageId = ctx.message?.message_id;
                if (fromChatId !== undefined && messageId !== undefined) {
                    try {
                        await this.bot.api.copyMessage(channelId, fromChatId, messageId, {
                            caption: captionHtml,
                            parse_mode: PARSE_HTML,
                            reply_markup: keyboard,
                        });
                    } catch (copyErr) {
                        console.error("[MEDIA_HANDLER] copyMessage failed:", copyErr);
                        try {
                            if (proofType === "photo") {
                                await this.bot.api.sendPhoto(channelId, fileId, {
                                    caption: captionHtml,
                                    parse_mode: PARSE_HTML,
                                    reply_markup: keyboard,
                                });
                            } else {
                                await this.bot.api.sendDocument(channelId, fileId, {
                                    caption: captionHtml,
                                    parse_mode: PARSE_HTML,
                                    reply_markup: keyboard,
                                });
                            }
                        } catch (sendErr) {
                            console.error("[MEDIA_HANDLER] sendPhoto/sendDocument failed:", sendErr);
                        }
                    }
                }
            } catch (e) {
                console.error("[MEDIA_HANDLER]", e);
            }
        });

        this.bot.on("message:text", async (ctx, next) => {
            if (ctx.message.text.startsWith("/")) return next();
            const user = await this.userService.getOrCreateUser(
                ctx.from.id,
                ctx.from.first_name,
                ctx.from.username
            );
            if (
                user.step !== UserStep.AWAITING_PAYMENT &&
                user.step !== UserStep.AWAITING_PAYMENT_PROOF
            ) {
                return next();
            }
            const pending = await this.paymentService.getLatestPendingPayment(user.id);
            if (!pending) return next();
            const kind = this.paymentService.getPaymentMethodKindFromPayment(pending);
            if (kind !== "crypto" && kind !== "ton") {
                return next();
            }
            const normalized = ctx.message.text.trim();
            const txHashMatch = normalized.match(/\b(0x[a-fA-F0-9]{20,}|[A-Za-z0-9_-]{18,})\b/);
            if (!txHashMatch) {
                await ctx.reply(
                    "برای پرداخت رمزارزی، لطفاً هش تراکنش (Tx Hash) را ارسال کنید یا اسکرین‌شات بفرستید."
                );
                return;
            }
            await this.paymentService.recordProofText(pending.id, txHashMatch[1], kind);
            await this.userService.setUserStep(user.id, UserStep.CONFIRMING_PAYMENT);
            await ctx.reply(MESSAGES.PAYMENT_RECEIVED, { parse_mode: PARSE_HTML });

            const channelId = this.env.CHANNEL_ID ? `-100${this.env.CHANNEL_ID}` : null;
            if (!channelId) return;
            const captionHtml =
                `🔔 <b>درخواست بررسی پرداخت رمزارزی</b>\n\n` +
                `👤 ${escapeHtml(ctx.from.first_name || "")}\n` +
                `🪙 نوع: ${escapeHtml(kind.toUpperCase())}\n` +
                `💰 ${escapeHtml(pending.amount.toLocaleString())} تومان\n` +
                `🧾 TxHash: <code>${escapeHtml(txHashMatch[1])}</code>\n` +
                `🔖 <code>${escapeHtml(pending.transaction_id)}</code> · payment #${pending.id}`;
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: "✅ تایید", callback_data: `ap:${pending.id}` },
                        { text: "❌ رد", callback_data: `rj:${pending.id}` },
                    ],
                ],
            };
            try {
                await this.bot.api.sendMessage(channelId, captionHtml, {
                    parse_mode: PARSE_HTML,
                    reply_markup: keyboard,
                });
            } catch (notifyErr) {
                console.error("[CRYPTO_PROOF_NOTIFY]", notifyErr);
            }
        });

        this.bot.on("pre_checkout_query", async (ctx) => {
            await ctx.answerPreCheckoutQuery(true);
        });

        this.bot.on("message:successful_payment", async (ctx) => {
            const payload = ctx.message.successful_payment.invoice_payload ?? "";
            if (!payload.startsWith("ton:")) return;
            const parts = payload.split(":");
            const paymentId = Number(parts[1]);
            if (!Number.isFinite(paymentId) || paymentId <= 0) return;
            if (!(await this.ensureSalesEnabledForPurchase(ctx, "ton-successful-payment"))) return;
            const result = await fulfillPaymentAfterApproval({
                userService: this.userService,
                paymentService: this.paymentService,
                inventoryService: this.inventoryService,
                vpnAccountService: this.vpnAccountService,
                productTypeService: this.inventoryService.getProductTypes(),
                catalogService: this.catalogService,
                bot: this.bot,
                paymentId,
                isTestMode: this.env.TEST_MODE === "true",
                adminBotToken: this.env.ADMIN_BOT_TOKEN,
            });
            if (!result.ok) {
                await ctx.reply("پرداخت ثبت شد ولی تحویل خودکار انجام نشد. پشتیبانی پیگیری می‌کند.");
            } else {
                await ctx.reply("✅ پرداخت با موفقیت انجام شد و اشتراک شما تحویل داده شد.");
            }
        });
    }

    /**
     * Register the message handler
     */
    private registerMessageHandler() {
        this.bot.on("message:text", async (ctx) => {
            try {
                // Skip commands - they're handled by command handlers
                if (ctx.message.text.startsWith('/')) {
                    return;
                }
                
                console.log(`[MESSAGE] From ${ctx.from.first_name} (${ctx.from.id}): ${ctx.message.text}`);
                
                // Get or create user
                const user = await this.userService.getOrCreateUser(
                    ctx.from.id,
                    ctx.from.first_name,
                    ctx.from.username
                );

                console.log(`[USER_STATE] User ${user.id} is in state: ${user.step}`);
                
                // Handle user based on state
                if (user.step === UserStep.START || user.step === UserStep.IDLE) {
                    // Show main menu for new users or users in idle state
                    await ctx.reply(MESSAGES.WELCOME, { 
                        reply_markup: this.mainMenu,
                        parse_mode: PARSE_HTML
                    });
                } else if (user.step === UserStep.SELECTING_PLAN) {
                    if (
                        !(await this.ensureSalesEnabledForPurchase(
                            ctx,
                            "message-selecting-plan",
                            user.id,
                            user.step
                        ))
                    ) {
                        return;
                    }
                    await this.showPlanSelection(ctx);
                } else if (user.step === UserStep.AWAITING_PAYMENT_METHOD) {
                    if (
                        !(await this.ensureSalesEnabledForPurchase(
                            ctx,
                            "message-awaiting-payment-method",
                            user.id,
                            user.step
                        ))
                    ) {
                        return;
                    }
                    const session = this.paymentMethodContextByTelegramId.get(ctx.from.id);
                    if (!session || Date.now() - session.createdAt > 20 * 60_000) {
                        await ctx.reply("برای ادامه خرید دوباره یک پلن انتخاب کنید.");
                        await this.showPlanSelection(ctx);
                        return;
                    }
                    await this.showPaymentMethodSelection(ctx, session.plan, session.methods);
                } else if (
                    user.step === UserStep.AWAITING_USERNAME ||
                    user.step === UserStep.AWAITING_PASSWORD
                ) {
                    if (
                        !(await this.ensureSalesEnabledForPurchase(
                            ctx,
                            "message-legacy-awaiting-proof",
                            user.id,
                            user.step
                        ))
                    ) {
                        return;
                    }
                    await this.userService.setUserStep(user.id, UserStep.AWAITING_PAYMENT_PROOF);
                    const pendingPayment = await this.paymentService.getLatestPendingPayment(user.id);
                    if (!pendingPayment) {
                        await ctx.reply(MESSAGES.ERROR, { parse_mode: PARSE_HTML });
                        return;
                    }
                    const planInfo = await this.catalogService.getPlanByInternalPlanKey(pendingPayment.plan);
                    await ctx.reply(
                        `📋 پلن انتخابی: ${planInfo?.title ?? pendingPayment.plan}\n💲 مبلغ قابل پرداخت: ${pendingPayment.amount.toLocaleString()} تومان`
                    );
                    await ctx.reply(
                        "⚠️ فرآیند خرید به‌روز شد؛ لطفاً پس از واریز، <b>عکس رسید</b> یا <b>اسکرین‌شات پیامک</b> را ارسال کنید.",
                        { parse_mode: PARSE_HTML }
                    );
                    const instructions = this.paymentService.getPaymentInstructions(
                        pendingPayment.id,
                        pendingPayment.transaction_id,
                        pendingPayment.amount
                    );
                    await ctx.reply(instructions, { parse_mode: PARSE_HTML });
                } else if (
                    user.step === UserStep.AWAITING_PAYMENT ||
                    user.step === UserStep.AWAITING_PAYMENT_PROOF
                ) {
                    await ctx.reply(MESSAGES.INVALID_CARD_NUMBER, { parse_mode: "MarkdownV2" });
                } else {
                    console.log(`[USER_STATE] Unhandled user state: ${user.step} for user ${user.id}`);
                    await ctx.reply(MESSAGES.ERROR + "\n\nلطفاً با ارسال /start دوباره شروع کنید.", { parse_mode: PARSE_HTML });
                }
            } catch (error) {
                console.error(`[MESSAGE_ERROR] Error handling message:`, error);
                await ctx.reply(MESSAGES.ERROR, { parse_mode: PARSE_HTML });
            }
        });
    }
    
    /**
     * Process a webhook update
     */
    async processUpdate(update: any) {
        try {
            console.log(`[UPDATE] Processing update: ${JSON.stringify(update).substring(0, 200)}...`);
            
            // Initialize bot if not already done
            try {
                await this.init();
            } catch (initError) {
                console.error(`[UPDATE_ERROR] Failed to initialize bot during update processing:`, initError);
                // Try to continue anyway in test mode
                if (this.env.TEST_MODE === 'true') {
                    console.log(`[TEST_MODE] Attempting to continue despite initialization error`);
                } else {
                    throw initError;
                }
            }
            
            // Check for required fields in the update to help diagnose issues
            if (!update) {
                console.error(`[UPDATE_ERROR] Received empty update`);
                return false;
            }
            
            // Verify update structure for message updates
            if (update.message) {
                console.log(`[UPDATE] Received message update from ${update.message.from?.first_name} (${update.message.from?.id})`);
                if (!update.message.from) {
                    console.warn(`[UPDATE_WARNING] Message update missing 'from' field`);
                }
                if (!update.message.chat) {
                    console.warn(`[UPDATE_WARNING] Message update missing 'chat' field`);
                }
                if (!update.message.text && !update.message.photo && !update.message.document) {
                    console.warn(`[UPDATE_WARNING] Message update missing text/media content`);
                }
            } else if (update.callback_query) {
                console.log(`[UPDATE] Received callback query update: ${update.callback_query.data}`);
            } else {
                console.log(`[UPDATE] Received non-message update type: ${Object.keys(update).join(', ')}`);
            }
            
            // Let the bot handle the update
            try {
                await this.bot.handleUpdate(update);
                console.log(`[UPDATE] Successfully processed update`);
                return true;
            } catch (botError) {
                console.error(`[UPDATE_ERROR] Bot failed to handle update:`, botError);
                
                // In test mode, attempt to provide a direct response
                if (this.env.TEST_MODE === 'true' && update.message?.chat?.id) {
                    try {
                        console.log(`[TEST_MODE] Sending fallback message to user`);
                        await this.bot.api.sendMessage(
                            update.message.chat.id, 
                            MESSAGES.ERROR + "\n\n🔧 حالت آزمایشی فعال است",
                            { parse_mode: PARSE_HTML }
                        );
                    } catch (sendError) {
                        console.error(`[SEND_ERROR] Failed to send fallback message:`, sendError);
                    }
                }
                
                // Notify channel if possible
                try {
                    const errorMsg =
                        `⚠️ <b>خطای بات</b>\n\n` +
                        `❌ <code>${escapeHtml(String(botError instanceof Error ? botError.message : 'خطای ناشناخته'))}</code>\n` +
                        `⏱️ زمان: ${escapeHtml(new Date().toISOString())}`;
                    const channelId = this.env.CHANNEL_ID ? `-100${this.env.CHANNEL_ID}` : null;
                    
                    if (channelId) {
                        await this.bot.api.sendMessage(channelId, errorMsg, { parse_mode: PARSE_HTML });
                        console.log(`[CHANNEL_NOTIFY] Bot error notification sent to channel ${channelId}`);
                    } else {
                        // Fallback to admin user
                        await this.bot.api.sendMessage(this.env.ADMIN_USER_ID, errorMsg, { parse_mode: PARSE_HTML });
                        console.log(`[ADMIN_NOTIFY] Bot error notification sent to admin user`);
                    }
                } catch (notifyError) {
                    console.error(`[CHANNEL_NOTIFY_ERROR] Failed to notify about update error:`, notifyError);
                }
                
                throw botError;
            }
        } catch (error) {
            console.error("[UPDATE_ERROR] Failed to process update:", error);
            
            // Notify admin if possible
            try {
                if (this.env.ADMIN_USER_ID) {
                    const errorMsg =
                        `⚠️ <b>خطای بات</b>\n\n` +
                        `❌ <code>${escapeHtml(String(error instanceof Error ? error.message : 'خطای ناشناخته'))}</code>\n` +
                        `⏱️ زمان: ${escapeHtml(new Date().toISOString())}`;
                    await this.bot.api.sendMessage(this.env.ADMIN_USER_ID, errorMsg, { parse_mode: PARSE_HTML });
                }
            } catch (notifyError) {
                console.error(`[ADMIN_NOTIFY_ERROR] Failed to notify admin about update error:`, notifyError);
            }
            
            return false;
        }
    }

    /**
     * Check webhook status
     */
    async getWebhookInfo(): Promise<any> {
        try {
            console.log(`[WEBHOOK] Getting webhook info`);
            const response = await fetch(
                `https://api.telegram.org/bot${this.env.BOT_TOKEN}/getWebhookInfo`
            );
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[WEBHOOK_ERROR] Failed to get webhook info: ${errorText}`);
                return null;
            }
            
            const result = await response.json() as { 
                ok: boolean; 
                result?: {
                    url: string;
                    has_custom_certificate: boolean;
                    pending_update_count: number;
                    last_error_date?: number;
                    last_error_message?: string;
                    max_connections: number;
                };
                description?: string;
            };
            
            if (result.ok && result.result) {
                console.log(`[WEBHOOK] Current webhook info:`, result.result);
                return result.result;
            } else {
                console.error(`[WEBHOOK_ERROR] Telegram API returned error: ${result.description || 'Unknown error'}`);
                return null;
            }
        } catch (error) {
            console.error(`[WEBHOOK_ERROR] Error getting webhook info:`, error);
            return null;
        }
    }
    
    /**
     * Set up the bot's webhook
     * @param url - The webhook URL
     */
    async setupWebhook(url: string): Promise<boolean> {
        try {
            console.log(`[WEBHOOK] Setting up webhook to URL: ${url}`);
            const response = await fetch(
                `https://api.telegram.org/bot${this.env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`
            );
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[WEBHOOK_ERROR] Failed to set webhook: ${errorText}`);
                return false;
            }
            
            const result = await response.json() as { 
                ok: boolean; 
                result?: boolean;
                description?: string;
            };
            
            if (result.ok) {
                console.log(`[WEBHOOK] Successfully set webhook to ${url}`);
                return true;
            } else {
                console.error(`[WEBHOOK_ERROR] Telegram API returned error: ${result.description || 'Unknown error'}`);
                return false;
            }
        } catch (error) {
            console.error(`[WEBHOOK_ERROR] Error setting webhook:`, error);
            return false;
        }
    }
}