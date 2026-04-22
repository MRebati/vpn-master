/**
 * User conversation step states
 */
export enum UserStep {
  START = 'start',
  IDLE = 'idle',
  SELECTING_PLAN = 'selecting_plan',
  AWAITING_PAYMENT_METHOD = 'awaiting_payment_method',
  AWAITING_PAYMENT_PROOF = 'awaiting_payment_proof',
  AWAITING_PAYMENT = 'awaiting_payment',
  /** @deprecated legacy — migrated to AWAITING_PAYMENT */
  AWAITING_USERNAME = 'awaiting_username',
  AWAITING_PASSWORD = 'awaiting_password',
  AWAITING_CARD_NUMBER = 'awaiting_card_number',
  ENTERING_PAYMENT = 'entering_payment',
  CONFIRMING_PAYMENT = 'confirming_payment',
  PAYMENT_COMPLETED = 'payment_completed'
}

/**
 * Payment status types
 */
export enum PaymentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired'
}

/**
 * VPN types available
 */
export enum VpnType {
  OPENVPN = 'openvpn',
  V2RAY = 'v2ray'
}

export const MESSAGES = {
    WELCOME: "✨ *به ربات VPNMasters خوش آمدید\\!* 🚀\n\n" +
             "🔐 _امن‌ترین و سریع‌ترین سرویس VPN با پشتیبانی 24/7_\n\n" +
             "👇 برای شروع، از منوی زیر گزینه مورد نظر خود را انتخاب کنید:",
             
    SELECT_PLAN: "📱 *انتخاب اشتراک VPN*\n\n" +
                "🔍 لطفاً مدت زمان اشتراک خود را انتخاب کنید:",
                
    PROMPT_USERNAME: "👤 *انتخاب نام کاربری*\n\n" + 
        "لطفاً نام کاربری دلخواه خود را برای اکانت VPN وارد کنید\\.\n\n" + 
        "⚠️ _نام کاربری باید حداقل 4 کاراکتر و فقط شامل حروف انگلیسی و اعداد باشد\\._",
        
    USERNAME_INVALID: "❌ *نام کاربری نامعتبر است*\n\n" +
        "لطفاً یک نام کاربری دیگر وارد کنید که:\n" +
        "• حداقل 4 کاراکتر باشد\n" +
        "• فقط شامل حروف انگلیسی و اعداد باشد",
        
    USERNAME_ACCEPTED: "✅ *نام کاربری پذیرفته شد*\n" +
                      "_نام کاربری شما با موفقیت ثبت شد\\._",
                      
    PROMPT_PASSWORD: "🔑 *انتخاب رمز عبور*\n\n" + 
        "لطفاً رمز عبور دلخواه خود را برای اکانت VPN وارد کنید\\.\n\n" +
        "⚠️ _رمز عبور باید دقیقاً 4 رقم باشد\\._",
        
    PASSWORD_INVALID: "❌ *رمز عبور نامعتبر است*\n\n" +
                     "لطفاً فقط 4 رقم وارد کنید\\.",
                     
    PASSWORD_ACCEPTED: "✅ *رمز عبور پذیرفته شد*\n" +
                      "_رمز عبور شما با موفقیت ثبت شد\\._",
    
    PAYMENT_INSTRUCTIONS: (price: number, cardNumber: string) => 
        `💳 *پرداخت اشتراک VPN*\n\n` +
        `💰 مبلغ: *${price.toLocaleString()} تومان*\n\n` +
        `🏦 شماره کارت:\n` +
        `\`${cardNumber}\`\n\n` +
        `📲 _پس از واریز، فقط 6 رقم آخر کارت خود را ارسال کنید\\._\n\n` +
        `⏱ زمان باقیمانده برای پرداخت: *15 دقیقه*`,
    
    PAYMENT_RECEIVED: "✅ *رسید شما دریافت شد*\n\n" +
                     "⏳ پشتیبان پرداخت را بررسی می‌کند\\. پس از تایید، اطلاعات اکانت برای شما ارسال می‌شود\\.\n\n" +
                     "_لطفاً صبور باشید\\._",
                     
    INVALID_CARD_NUMBER: "❌ *ورودی نامعتبر*\n\n" +
                        "لطفاً *عکس رسید* یا *اسکرین‌شات پیامک بانک* را ارسال کنید\\.",

    SALES_PAUSED: "⛔️ *فروش موقتاً متوقف شده است*",
    SALES_RETRY_LATER: "لطفاً کمی بعد دوباره تلاش کنید\\.",
    SALES_SUPPORT_HINT: "در صورت نیاز با پشتیبانی تماس بگیرید\\.",
                        
    HELP: "🔰 *راهنمای استفاده از VPNMasters*\n\n" +
        "1️⃣ «خرید اشتراک» را بزنید و پلن را انتخاب کنید\n" +
        "2️⃣ مبلغ را به شماره کارت اعلام‌شده واریز کنید\n" +
        "3️⃣ *عکس رسید* یا *اسکرین‌شات پیامک* را در ربات بفرستید\n" +
        "4️⃣ پس از تایید پشتیبان، اکانت از موجودی اختصاص داده می‌شود\n" +
        "5️⃣ از «اکانت‌های من» لیست اکانت‌های خریداری‌شده را ببینید\n\n" +
        "❓ _پشتیبانی از منوی پشتیبانی_",
        
    SUPPORT: "📞 *پشتیبانی VPNMasters*\n\n" +
        "برای ارتباط با پشتیبانی:\n" +
        "Telegram ID: `@support`\n\n" +
        "_پاسخگوی شما هستیم 7 روز هفته، 24 ساعته_",
        
    ERROR: "❌ *خطا در عملیات*\n\n" +
          "متأسفانه مشکلی پیش آمده است\\. لطفاً دوباره تلاش کنید\\.\n" +
          "_اگر مشکل ادامه داشت، با پشتیبانی تماس بگیرید\\._",
          
    SELECT_VPN_TYPE: "🌐 *انتخاب نوع VPN*\n\n" +
                    "لطفاً نوع VPN مورد نظر خود را انتخاب کنید:",
                    
    VPN_CONFIG_OPENVPN: "📥 *فایل کانفیگ OpenVPN شما آماده است\\!*\n\n" +
                       "_برای نصب و راه‌اندازی، فایل را دانلود کرده و طبق راهنما عمل کنید\\._",
                       
    VPN_CONFIG_V2RAY: "📥 *فایل کانفیگ V2Ray شما آماده است\\!*\n\n" +
                     "_برای نصب و راه‌اندازی، فایل را دانلود کرده و طبق راهنما عمل کنید\\._"
} as const; 