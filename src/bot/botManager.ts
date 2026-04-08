import { Bot, Context } from "grammy";
import { Menu, MenuRange } from "@grammyjs/menu";
import { UserService } from "../services/userService";
import { PaymentService } from "../services/paymentService";
import { VpnAccountService } from "../services/vpnAccountService";
import { SettingsService } from "../services/settingsService";
import { InventoryService } from "../services/inventoryService";
import { fulfillPaymentAfterApproval } from "../services/fulfillmentService";
import { MESSAGES, VPN_PLANS, VpnPlanKey, UserStep } from "../constants";
import { Env } from "../index";
import { createClient } from "@supabase/supabase-js";
import { Database } from "../types";
import { canActAsStaff } from "../utils/staffAccess";

// Bot context type with environment
export type BotContext = Context & { env: Env };

export class BotManager {
    private bot: Bot<BotContext>;
    private userService: UserService;
    private paymentService: PaymentService;
    private vpnAccountService: VpnAccountService;
    private settingsService: SettingsService;
    private inventoryService: InventoryService;
    private plansMenu: Menu<BotContext>;
    private mainMenu: Menu<BotContext>;
    private env: Env;
    private isInitialized = false;

    constructor(env: Env) {
        try {
            console.log(`[BOT_INIT] Initializing bot with token: ${env.BOT_TOKEN.substring(0, 8)}...`);
            this.env = env;
            
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
                            await ctx.reply(MESSAGES.ERROR);
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
            this.settingsService = new SettingsService(supabase);
            this.inventoryService = new InventoryService(supabase);
            
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
                await ctx.reply(MESSAGES.ERROR + "\n\n🔧 حالت آزمایشی فعال است");
            })
            .row()
            .text("سه ماهه", async (ctx) => {
                await ctx.reply(MESSAGES.ERROR + "\n\n🔧 حالت آزمایشی فعال است");
            });
            
        this.mainMenu = new Menu<BotContext>("main-menu-fallback")
            .text("🛍 خرید اشتراک", async (ctx) => {
                await ctx.reply(MESSAGES.ERROR + "\n\n🔧 حالت آزمایشی فعال است");
            })
            .row()
            .text("❓ راهنما", async (ctx) => {
                await ctx.reply(MESSAGES.HELP);
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
    
    /**
     * Create menu objects
     */
    private createMenus() {
        // Plans menu
        const plansMenu = new Menu<BotContext>("plans-menu")
            .dynamic(() => {
                const range = new MenuRange<BotContext>();
                Object.entries(VPN_PLANS).forEach(([key, plan], index) => {
                    // Add each plan button on a separate row
                    range.text(plan.name, async (ctx) => {
                        console.log(`[PLAN_SELECTED] User ${ctx.from.id} selected plan: ${key}`);
                        
                        try {
                            // Get or create user
                            console.log(`[PLAN_DEBUG] Attempting to get/create user for ${ctx.from.id}`);
                            const user = await this.userService.getOrCreateUser(
                                ctx.from.id,
                                ctx.from.first_name,
                                ctx.from.username
                            );
                            console.log(`[PLAN_DEBUG] User obtained: ${JSON.stringify(user)}`);
                            
                            // Update user with selected plan
                            console.log(`[PLAN_DEBUG] Updating user with plan: ${key}`);
                            await this.userService.selectPlan(
                                user.id,
                                key as VpnPlanKey,
                                plan.price
                            );
                            console.log(`[PLAN_DEBUG] User updated with plan successfully`);
                            
                            // Create payment record
                            console.log(`[PLAN_DEBUG] Creating payment record for user ${user.id}`);
                            const payment = await this.paymentService.createPayment(
                                user.id, 
                                key as VpnPlanKey
                            );
                            console.log(`[PAYMENT_CREATED] Created payment ID: ${payment.id}, Transaction ID: ${payment.transaction_id} for user ${user.id}`);

                            await this.userService.setUserStep(user.id, UserStep.AWAITING_PAYMENT);

                            const card = await this.settingsService.getCardNumber(this.env.CARD_NUMBER);
                            const planKey = key as VpnPlanKey;
                            const planInfo = VPN_PLANS[planKey];
                            await ctx.reply(
                                `📋 پلن انتخابی: ${planInfo.name}\n💲 مبلغ قابل پرداخت: ${payment.amount.toLocaleString()} تومان`,
                                { parse_mode: "MarkdownV2" }
                            );
                            const instructions = this.paymentService.getPaymentInstructions(
                                payment.id,
                                payment.transaction_id,
                                payment.amount,
                                card
                            );
                            await ctx.reply(instructions, { parse_mode: "MarkdownV2" });
                        } catch (error) {
                            console.error(`[ERROR] Error in plan selection handler:`, error);
                            if (error instanceof Error) {
                                console.error(`[ERROR_DETAILS] ${error.message}`);
                                if (error.stack) {
                                    console.error(`[ERROR_STACK] ${error.stack}`);
                                }
                            }
                            
                            // Try to provide a more specific error message
                            let errorMsg = MESSAGES.ERROR;
                            if (error instanceof Error) {
                                errorMsg += `\n\nخطا: ${error.message}`;
                            }
                            
                            await ctx.reply(errorMsg);
                        }
                    });
                    // Add a row after each button (except for the last one)
                    if (index < Object.entries(VPN_PLANS).length - 1) {
                        range.row();
                    }
                });
                return range;
            });

        // Main menu
        const mainMenu = new Menu<BotContext>("main-menu")
            .text("🛍 خرید اشتراک", async (ctx) => {
                await ctx.reply(MESSAGES.SELECT_PLAN, { reply_markup: plansMenu });
            })
            .row()
            .text("🔄 تمدید اشتراک", async (ctx) => {
                await ctx.reply(MESSAGES.SELECT_PLAN, { reply_markup: plansMenu });
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
                    (a, i) =>
                        `${i + 1}. ${a.username} — انقضا: ${new Date(a.expiry_date).toLocaleDateString("fa-IR")}`
                );
                await ctx.reply("📋 اکانت‌های شما:\n\n" + lines.join("\n"));
            })
            .row()
            .text("❓ راهنما", async (ctx) => {
                console.log(`[HELP] Showing help to user ${ctx.from.id} (${ctx.from.first_name})`);
                await ctx.reply(MESSAGES.HELP);
            })
            .row()
            .text("📞 پشتیبانی", async (ctx) => {
                console.log(`[SUPPORT] Showing support info to user ${ctx.from.id} (${ctx.from.first_name})`);
                const text = await this.settingsService.getSupportChannel(MESSAGES.SUPPORT);
                await ctx.reply(text);
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
                    await ctx.reply(MESSAGES.WELCOME, { reply_markup: this.mainMenu });
                    console.log(`[REPLY] Welcome message sent successfully to user ${ctx.from.id}`);
                } catch (dbError) {
                    console.error(`[DB_ERROR] Error in database operation during /start command:`, dbError);
                    
                    // In test mode, we can proceed even without database connection
                    const isTestMode = this.env.TEST_MODE === 'true';
                    if (isTestMode) {
                        console.log(`[TEST_MODE] Continuing in test mode despite database error`);
                        await ctx.reply(MESSAGES.WELCOME + "\n\n🔧 حالت آزمایشی فعال است", { 
                            reply_markup: this.mainMenu 
                        });
                    } else {
                        throw dbError; // Re-throw to be caught by the outer catch block
                    }
                }
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /start command:`, error);
                
                // Send a more friendly error message to the user
                const errorMsg = `${MESSAGES.ERROR}\n\nکد خطا: ${error instanceof Error ? error.message.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : 'خطای ناشناخته'}`;
                await ctx.reply(errorMsg, { parse_mode: "MarkdownV2" });
                
                // Notify channel about the error if possible
                try {
                    const adminErrorMsg = `⚠️ *خطای مدیریتی*\n❌ خطا: ${(error.message || 'خطای ناشناخته').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}\n⏱️ زمان: ${new Date().toISOString()}`;
                    const channelId = this.env.CHANNEL_ID ? `-100${this.env.CHANNEL_ID}` : null;
                    
                    if (channelId) {
                        await this.bot.api.sendMessage(channelId, adminErrorMsg, { parse_mode: "MarkdownV2" });
                        console.log(`[CHANNEL_NOTIFY] Admin error notification sent to channel ${channelId}`);
                    } else {
                        // Fallback to admin user
                        await this.bot.api.sendMessage(this.env.ADMIN_USER_ID, adminErrorMsg, { parse_mode: "MarkdownV2" });
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
                    { caption: MESSAGES.HELP, parse_mode: "MarkdownV2" }
                );
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /help command:`, error);
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
                    await this.bot.api.sendMessage(`-100${channelIdFromEnv}`, testMessage, { parse_mode: "MarkdownV2" });
                    await ctx.reply(`✅ Success! Message sent to channel with ID: -100${channelIdFromEnv}`);
                } catch (error) {
                    await ctx.reply(`❌ Failed: ${error.message}`);
                
                    await ctx.reply("Attempt 2: Trying with username format: @VPNMasters_Support");
                    try {
                        await this.bot.api.sendMessage('@VPNMasters_Support', testMessage, { parse_mode: "MarkdownV2" });
                        await ctx.reply("✅ Success! Message sent to channel with username: @VPNMasters_Support");
                    } catch (error2) {
                        await ctx.reply(`❌ Failed: ${error2.message}`);
                    
                        await ctx.reply(`Attempt 3: Trying with numeric ID only: ${channelIdFromEnv}`);
                        try {
                            await this.bot.api.sendMessage(channelIdFromEnv, testMessage, { parse_mode: "MarkdownV2" });
                            await ctx.reply(`✅ Success! Message sent to channel with ID: ${channelIdFromEnv}`);
                        } catch (error3) {
                            await ctx.reply(`❌ Failed: ${error3.message}`);
                            
                            await ctx.reply("Attempt 4: Trying with supergroupID (-100) format");
                            try {
                                await this.bot.api.sendMessage('-100' + channelIdFromEnv, testMessage, { parse_mode: "MarkdownV2" });
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
                    const message = `🔗 *Webhook Information*\n\n` +
                        `URL: ${webhookInfo.url ? webhookInfo.url.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : 'Not set'}\n` +
                        `Has Custom Certificate: ${webhookInfo.has_custom_certificate ? 'Yes' : 'No'}\n` +
                        `Pending Updates: ${webhookInfo.pending_update_count}\n` +
                        `Last Error Date: ${webhookInfo.last_error_date ? new Date(webhookInfo.last_error_date * 1000).toISOString() : 'None'}\n` +
                        `Last Error Message: ${webhookInfo.last_error_message ? webhookInfo.last_error_message.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : 'None'}\n` +
                        `Max Connections: ${webhookInfo.max_connections}`;
                        
                    await ctx.reply(message, { parse_mode: "MarkdownV2" });
                } else {
                    await ctx.reply("❌ Failed to get webhook information.");
                }
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /checkwebhook command:`, error);
                await ctx.reply(`${MESSAGES.ERROR}\n\nWebhook check error: ${error instanceof Error ? error.message.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : 'Unknown error'}`, { parse_mode: "MarkdownV2" });
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
                await ctx.reply(`${MESSAGES.ERROR}\n\nWebhook set error: ${error instanceof Error ? error.message.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : 'Unknown error'}`, { parse_mode: "MarkdownV2" });
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
                
                // Format the payment information
                const message = `💳 *Payment Details*\n` +
                    `🆔 Transaction ID: \`${payment.transaction_id}\`\n` +
                    `👤 User: ${user ? `${user.first_name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')} \\(ID: ${user.id}\\)` : `User ID: ${payment.user_id}`}\n` +
                    `💰 Amount: ${payment.amount} تومان\n` +
                    `📅 Plan: ${payment.plan}\n` +
                    `📊 Status: *${payment.status.toUpperCase()}*\n` +
                    `💳 Card: ${payment.card_last_digits || 'Not provided'}\n` +
                    `📆 Created: ${new Date(payment.created_at).toLocaleString('fa-IR')}\n` +
                    `📆 Updated: ${new Date(payment.updated_at).toLocaleString('fa-IR')}`;
                
                await ctx.reply(message, { parse_mode: "MarkdownV2" });
            } catch (error) {
                console.error(`[COMMAND_ERROR] Error handling /payment command:`, error);
                await ctx.reply(`${MESSAGES.ERROR}\n\nError: ${error instanceof Error ? error.message.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : 'Unknown error'}`, { parse_mode: "MarkdownV2" });
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
                await ctx.reply(`Error in channel check: ${error instanceof Error ? error.message.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : 'Unknown error'}`, { parse_mode: "MarkdownV2" });
            }
        });
    }
    
    private registerCallbackHandlers() {
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
                bot: this.bot,
                paymentId,
                isTestMode: this.env.TEST_MODE === "true",
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
        this.bot.on(["message:photo", "message:document"], async (ctx) => {
            try {
                const user = await this.userService.getOrCreateUser(
                    ctx.from.id,
                    ctx.from.first_name,
                    ctx.from.username
                );
                if (user.step !== UserStep.AWAITING_PAYMENT) return;

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
                await ctx.reply(MESSAGES.PAYMENT_RECEIVED, { parse_mode: "MarkdownV2" });

                const channelId = this.env.CHANNEL_ID ? `-100${this.env.CHANNEL_ID}` : null;
                if (!channelId) return;

                const caption =
                    `🔔 *رسید پرداخت*\n\n` +
                    `👤 ${(ctx.from.first_name || "").replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&")}\n` +
                    `💰 ${pending.amount.toLocaleString()} تومان\n` +
                    `🧾 \`${pending.transaction_id}\` · payment #${pending.id}`;

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: "✅ تایید", callback_data: `ap:${pending.id}` },
                            { text: "❌ رد", callback_data: `rj:${pending.id}` },
                        ],
                    ],
                };

                if (proofType === "photo") {
                    await this.bot.api.sendPhoto(channelId, fileId, {
                        caption,
                        parse_mode: "MarkdownV2",
                        reply_markup: keyboard,
                    });
                } else {
                    await this.bot.api.sendDocument(channelId, fileId, {
                        caption,
                        parse_mode: "MarkdownV2",
                        reply_markup: keyboard,
                    });
                }
            } catch (e) {
                console.error("[MEDIA_HANDLER]", e);
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
                        parse_mode: "MarkdownV2"
                    });
                } else if (user.step === UserStep.SELECTING_PLAN) {
                    // This should be handled by menu buttons, but just in case
                    await ctx.reply(MESSAGES.SELECT_PLAN, { 
                        reply_markup: this.plansMenu,
                        parse_mode: "MarkdownV2"
                    });
                } else if (
                    user.step === UserStep.AWAITING_USERNAME ||
                    user.step === UserStep.AWAITING_PASSWORD
                ) {
                    await this.userService.setUserStep(user.id, UserStep.AWAITING_PAYMENT);
                    const pendingPayment = await this.paymentService.getLatestPendingPayment(user.id);
                    if (!pendingPayment) {
                        await ctx.reply(MESSAGES.ERROR, { parse_mode: "MarkdownV2" });
                        return;
                    }
                    const card = await this.settingsService.getCardNumber(this.env.CARD_NUMBER);
                    const planInfo = VPN_PLANS[pendingPayment.plan];
                    await ctx.reply(
                        `📋 پلن انتخابی: ${planInfo.name}\n💲 مبلغ قابل پرداخت: ${pendingPayment.amount.toLocaleString()} تومان`,
                        { parse_mode: "MarkdownV2" }
                    );
                    await ctx.reply(
                        "⚠️ فرآیند خرید به‌روز شد؛ لطفاً پس از واریز، *عکس رسید* یا *اسکرین‌شات پیامک* را ارسال کنید\\.",
                        { parse_mode: "MarkdownV2" }
                    );
                    const instructions = this.paymentService.getPaymentInstructions(
                        pendingPayment.id,
                        pendingPayment.transaction_id,
                        pendingPayment.amount,
                        card
                    );
                    await ctx.reply(instructions, { parse_mode: "MarkdownV2" });
                } else if (user.step === UserStep.AWAITING_PAYMENT) {
                    await ctx.reply(MESSAGES.INVALID_CARD_NUMBER, { parse_mode: "MarkdownV2" });
                } else {
                    console.log(`[USER_STATE] Unhandled user state: ${user.step} for user ${user.id}`);
                    await ctx.reply(MESSAGES.ERROR + "\n\nلطفاً با ارسال /start دوباره شروع کنید.", { parse_mode: "MarkdownV2" });
                }
            } catch (error) {
                console.error(`[MESSAGE_ERROR] Error handling message:`, error);
                await ctx.reply(MESSAGES.ERROR, { parse_mode: "MarkdownV2" });
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
                            { parse_mode: "MarkdownV2" }
                        );
                    } catch (sendError) {
                        console.error(`[SEND_ERROR] Failed to send fallback message:`, sendError);
                    }
                }
                
                // Notify channel if possible
                try {
                    const errorMsg = `⚠️ *خطای بات*\n❌ خطا: ${(botError.message || 'خطای ناشناخته').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}\n⏱️ زمان: ${new Date().toISOString()}`;
                    const channelId = this.env.CHANNEL_ID ? `-100${this.env.CHANNEL_ID}` : null;
                    
                    if (channelId) {
                        await this.bot.api.sendMessage(channelId, errorMsg, { parse_mode: "MarkdownV2" });
                        console.log(`[CHANNEL_NOTIFY] Bot error notification sent to channel ${channelId}`);
                    } else {
                        // Fallback to admin user
                        await this.bot.api.sendMessage(this.env.ADMIN_USER_ID, errorMsg, { parse_mode: "MarkdownV2" });
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
                    const errorMsg = `⚠️ *خطای بات*\n❌ خطا: ${(error.message || 'خطای ناشناخته').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}\n⏱️ زمان: ${new Date().toISOString()}`;
                    await this.bot.api.sendMessage(this.env.ADMIN_USER_ID, errorMsg, { parse_mode: "MarkdownV2" });
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