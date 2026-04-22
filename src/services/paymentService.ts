import { SupabaseClient } from '@supabase/supabase-js';
import { Bot } from 'grammy';
import type {
    CustomerOrderStatus,
    Database,
    Payment,
    PaymentMethodKind,
} from '../types';
import { VpnPlanKey, VPN_PLANS, PaymentStatus } from '../constants';

const METHOD_PREFIX: Record<PaymentMethodKind, string> = {
    rial_card: 'RIAL',
    ton: 'TON',
    crypto: 'CRP',
    other: 'PAY',
};

/**
 * Service class for managing payments
 */
export class PaymentService {
    private supabase: SupabaseClient<Database>;
    private adminUserId: string;
    private cardNumber: string;
    private bot?: Bot;
    private channelId?: string;

    constructor(
        supabaseClient: SupabaseClient<Database>,
        adminUserId: string,
        cardNumber: string,
        bot?: Bot,
        channelId?: string
    ) {
        this.supabase = supabaseClient;
        this.adminUserId = adminUserId;
        this.cardNumber = cardNumber;
        this.bot = bot;
        this.channelId = channelId;
        
        console.log(`[PAYMENT_SERVICE] Initialized with admin ID: ${adminUserId}, channel ID: ${channelId || 'not set'}`);
    }

    /**
     * Generate a consistent transaction ID format
     * @returns Formatted transaction ID string
     */
    generateTransactionId(methodKind: PaymentMethodKind = 'rial_card'): string {
        const methodPrefix = METHOD_PREFIX[methodKind] ?? METHOD_PREFIX.other;
        const prefix = `TXN-${methodPrefix}`;
        const timestamp = Date.now().toString().substring(7, 13); // Last 6 digits of timestamp
        const randomStr = Math.random().toString(36).substring(2, 5); // Random alphanumeric (3 chars)
        return `${prefix}-${timestamp}-${randomStr}`;
    }

    /**
     * Create a new payment record with PENDING status
     * @param userId - The user ID
     * @param plan - The selected plan
     */
    async createPayment(
        userId: number,
        plan: VpnPlanKey,
        paymentMethodId: number = 0,
        paymentMethodKind: PaymentMethodKind = 'rial_card'
    ): Promise<Payment> {
        try {
            console.log(`[PAYMENT_SERVICE] Creating payment record for user ${userId} with plan ${plan}`);
            
            const amount = VPN_PLANS[plan].price;
            
            // Use the consistent method to generate transaction ID
            const transactionId = this.generateTransactionId(paymentMethodKind);
            console.log(`[PAYMENT_SERVICE] Generated transaction ID: ${transactionId}`);
            
            const { data: payment, error } = await this.supabase
                .from('payments')
                .insert({
                    user_id: userId,
                    amount,
                    plan,
                    status: 'PENDING',
                    card_last_digits: 'proof',
                    transaction_id: transactionId,
                    review_status: 'pending',
                })
                .select()
                .single();
            
            if (error) {
                console.error(`[DB_ERROR] Error creating payment record: ${error.message}`, error);
                throw new Error(`Failed to create payment record: ${error.message}`);
            }
            
            console.log(`[PAYMENT_SERVICE] Created payment ID: ${payment.id}, Transaction ID: ${payment.transaction_id} for user ${userId} with amount ${amount}`);
            await this.tryPersistMethodMetadata(payment.id, paymentMethodId, paymentMethodKind);
            return payment;
        } catch (error) {
            console.error('[DB_ERROR] Payment creation error:', error);
            throw error;
        }
    }

    /**
     * Manual sale by support: payment already completed (no bank proof in bot).
     */
    async createManualCompletedPayment(
        userId: number,
        plan: VpnPlanKey
    ): Promise<Payment> {
        const amount = VPN_PLANS[plan].price;
        const transactionId = `MANUAL-${METHOD_PREFIX.other}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { data, error } = await this.supabase
            .from('payments')
            .insert({
                user_id: userId,
                amount,
                plan,
                status: 'COMPLETED',
                card_last_digits: 'manual',
                transaction_id: transactionId,
                review_status: 'approved',
            })
            .select()
            .single();
        if (error) throw new Error(`createManualCompletedPayment: ${error.message}`);
        return data;
    }

    /**
     * Get payment by ID
     * @param paymentId - The payment ID
     */
    async getPaymentById(paymentId: number): Promise<Payment | null> {
        try {
            console.log(`[PAYMENT_SERVICE] Fetching payment with ID ${paymentId}`);
            
            const { data: payment, error } = await this.supabase
                .from('payments')
                .select('*')
                .eq('id', paymentId)
                .single();
            
            if (error) {
                if (error.code === 'PGRST116') {
                    console.log(`[PAYMENT_SERVICE] No payment found with ID ${paymentId}`);
                    return null;
                }
                console.error(`[DB_ERROR] Error fetching payment: ${error.message}`, error);
                throw new Error(`Failed to fetch payment: ${error.message}`);
            }
            
            console.log(`[PAYMENT_SERVICE] Found payment ID: ${payment.id}`);
            return payment;
        } catch (error) {
            console.error('[DB_ERROR] Payment fetch error:', error);
            throw error;
        }
    }

    /**
     * Get payment by user ID and status
     * @param userId - The user ID
     * @param status - The payment status
     */
    async getUserPaymentsByStatus(userId: number, status: PaymentStatus): Promise<Payment[]> {
        try {
            console.log(`[PAYMENT_SERVICE] Fetching payments for user ${userId} with status ${status}`);
            
            const { data: payments, error } = await this.supabase
                .from('payments')
                .select('*')
                .eq('user_id', userId)
                .eq('status', status)
                .order('created_at', { ascending: false });
            
            if (error) {
                console.error(`[DB_ERROR] Error fetching payments: ${error.message}`, error);
                throw new Error(`Failed to fetch payments: ${error.message}`);
            }
            
            console.log(`[PAYMENT_SERVICE] Found ${payments.length} ${status} payments for user ${userId}`);
            return payments;
        } catch (error) {
            console.error('[DB_ERROR] Payments fetch error:', error);
            throw error;
        }
    }

    /**
     * Get latest pending payment for a user
     * @param userId - The user ID
     */
    async getLatestPendingPayment(userId: number): Promise<Payment | null> {
        try {
            console.log(`[PAYMENT_SERVICE] Fetching latest pending payment for user ${userId}`);
            
            // Try with uppercase status first
            let { data: pendingPayments, error: error1 } = await this.supabase
                .from('payments')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'PENDING')
                .order('created_at', { ascending: false })
                .limit(1);
                
            // If no results with uppercase, try with lowercase status
            if ((!pendingPayments || pendingPayments.length === 0) && !error1) {
                const { data: lowerPayments, error: error2 } = await this.supabase
                    .from('payments')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('status', 'pending')
                    .order('created_at', { ascending: false })
                    .limit(1);
                    
                if (error2) {
                    console.error(`[DB_ERROR] Error fetching pending payment (lowercase): ${error2.message}`, error2);
                    throw new Error(`Failed to fetch pending payment: ${error2.message}`);
                }
                
                pendingPayments = lowerPayments;
            } else if (error1) {
                console.error(`[DB_ERROR] Error fetching pending payment: ${error1.message}`, error1);
                throw new Error(`Failed to fetch pending payment: ${error1.message}`);
            }
            
            if (!pendingPayments || pendingPayments.length === 0) {
                console.log(`[PAYMENT_SERVICE] No pending payments found for user ${userId}`);
                return null;
            }
            
            console.log(`[PAYMENT_SERVICE] Found pending payment ID: ${pendingPayments[0].id} for user ${userId}`);
            return pendingPayments[0];
        } catch (error) {
            console.error('[DB_ERROR] Pending payment fetch error:', error);
            throw error;
        }
    }

    inferPaymentMethodKind(transactionId: string | null | undefined): PaymentMethodKind {
        if (!transactionId) return 'rial_card';
        if (transactionId.includes('-TON-')) return 'ton';
        if (transactionId.includes('-CRP-')) return 'crypto';
        if (transactionId.includes('-RIAL-')) return 'rial_card';
        return 'other';
    }

    async getLatestOrderStatus(userId: number): Promise<CustomerOrderStatus | null> {
        const { data, error } = await this.supabase
            .from('payments')
            .select('id,status,review_status,created_at,updated_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw new Error(`Failed to fetch latest order status: ${error.message}`);
        if (!data) return null;
        return {
            paymentId: data.id,
            status: (data.status ?? 'PENDING') as CustomerOrderStatus['status'],
            reviewStatus: (data.review_status ?? 'pending') as CustomerOrderStatus['reviewStatus'],
            createdAt: data.created_at,
            updatedAt: data.updated_at,
        };
    }

    private async tryPersistMethodMetadata(
        paymentId: number,
        paymentMethodId: number,
        paymentMethodKind: PaymentMethodKind
    ): Promise<void> {
        try {
            const metadata = JSON.stringify({
                paymentMethodId,
                paymentMethodKind,
            });
            const updateQuery = this.supabase
                .from('payments')
                .update({ card_last_digits: metadata });
            if (!updateQuery || typeof (updateQuery as any).eq !== 'function') return;
            const result = await (updateQuery as any).eq('id', paymentId).eq('status', 'PENDING');
            const error = result?.error;
            if (error) {
                console.warn('[PAYMENT_SERVICE] Could not persist method metadata:', error.message);
            }
        } catch (err) {
            console.warn('[PAYMENT_SERVICE] Metadata persistence skipped:', err);
        }
    }

    async expireStalePendingPayments(timeoutMinutes = 30): Promise<number> {
        const cutoff = new Date(Date.now() - timeoutMinutes * 60_000).toISOString();
        const { data, error } = await this.supabase
            .from('payments')
            .update({ status: 'EXPIRED' })
            .eq('status', 'PENDING')
            .lt('created_at', cutoff)
            .select('id');
        if (error) {
            console.error('[PAYMENT_SERVICE] expireStalePendingPayments failed:', error.message);
            return 0;
        }
        return data?.length ?? 0;
    }

    /**
     * Update payment status
     * @param paymentId - The payment ID
     * @param status - The new payment status
     * @param cardLastDigits - Last digits of the card (for completed payments)
     */
    async updatePaymentStatus(
        paymentId: number, 
        status: string, 
        cardLastDigits?: string
    ): Promise<Payment> {
        try {
            console.log(`[PAYMENT_SERVICE] Updating payment ${paymentId} status to ${status}`);
            
            const updateData: {
                status: string;
                card_last_digits?: string;
            } = { status };
            
            if (cardLastDigits) {
                updateData.card_last_digits = cardLastDigits;
            }
            
            const { data: payment, error } = await this.supabase
                .from('payments')
                .update(updateData)
                .eq('id', paymentId)
                .select()
                .single();
            
            if (error) {
                console.error(`[DB_ERROR] Error updating payment status: ${error.message}`, error);
                throw new Error(`Failed to update payment status: ${error.message}`);
            }
            
            console.log(`[PAYMENT_SERVICE] Successfully updated payment ${paymentId} status to ${status}`);
            return payment;
        } catch (error) {
            console.error('[DB_ERROR] Payment status update error:', error);
            throw error;
        }
    }

    /**
     * Payment instructions: user pays then sends screenshot / SMS photo for manual approval.
     */
    getPaymentInstructions(
        paymentId: number,
        transactionId: string = '',
        amount: number = 0,
        cardNumber: string = this.cardNumber
    ): string {
        try {
            console.log(`[PAYMENT_SERVICE] Generating payment instructions for payment ID: ${paymentId}`);

            const boldAmount =
                amount > 0
                    ? `💰 *مبلغ قابل پرداخت:* *${amount.toLocaleString()} تومان*\n\n`
                    : '';

            return (
                boldAmount +
                `💳 *شماره کارت:*\n\`${cardNumber}\`\n\n` +
                `📸 بعد از واریز، *عکس رسید* یا *اسکرین‌شات پیامک بانک* را همینجا بفرستید تا پشتیبان بررسی کند\\.\n\n` +
                `🧾 *شناسه تراکنش:* \`${transactionId || paymentId}\``
            );
        } catch (error) {
            console.error(`[PAYMENT_SERVICE] Error generating payment instructions:`, error);
            return `💰 *مبلغ پرداختی*\n\n💳 *شماره کارت:* \`${cardNumber}\`\n\n📸 بعد از واریز، عکس رسید را ارسال کنید\\._`;
        }
    }

    /**
     * Store Telegram file id for payment proof (photo or document).
     */
    async recordProof(
        paymentId: number,
        proofFileId: string,
        proofType: 'photo' | 'document'
    ): Promise<Payment> {
        const { data, error } = await this.supabase
            .from('payments')
            .update({
                proof_file_id: proofFileId,
                proof_type: proofType,
                review_status: 'pending',
            })
            .eq('id', paymentId)
            .eq('status', 'PENDING')
            .select()
            .single();

        if (error) throw new Error(`recordProof: ${error.message}`);
        return data;
    }

    async setReviewStatus(
        paymentId: number,
        reviewStatus: 'pending' | 'approved' | 'rejected'
    ): Promise<void> {
        const { error } = await this.supabase
            .from('payments')
            .update({ review_status: reviewStatus })
            .eq('id', paymentId);
        if (error) throw new Error(error.message);
    }

    /**
     * Verify a payment based on card digits
     * @param paymentId - The payment ID
     * @param cardDigits - Last digits of the card or receipt details
     */
    async verifyPayment(paymentId: number, cardDigits: string): Promise<boolean> {
        try {
            console.log(`[PAYMENT_SERVICE] Verifying payment ${paymentId} with card digits ${cardDigits}`);
            
            // First check if payment exists and is in PENDING status
            const { data: payment, error: fetchError } = await this.supabase
                .from('payments')
                .select('*')
                .eq('id', paymentId)
                .eq('status', 'PENDING')
                .single();
                
            if (fetchError) {
                console.error(`[PAYMENT_SERVICE] Error fetching payment for verification: ${fetchError.message}`, fetchError);
                throw new Error(`Payment verification failed: Payment not found or not in PENDING status`);
            }
            
            // Update payment with card digits and mark as COMPLETED
            const { data: updatedPayment, error: updateError } = await this.supabase
                .from('payments')
                .update({ 
                    status: 'COMPLETED',
                    card_last_digits: cardDigits
                })
                .eq('id', paymentId)
                .select()
                .single();
            
            if (updateError) {
                console.error(`[PAYMENT_SERVICE] Error updating payment status: ${updateError.message}`, updateError);
                throw new Error(`Payment verification failed: Could not update payment status`);
            }
            
            console.log(`[PAYMENT_SERVICE] Successfully verified payment ${paymentId}`);
            return true;
        } catch (error) {
            console.error('[PAYMENT_SERVICE] Payment verification error:', error);
            
            // Mark payment as FAILED if verification process fails
            try {
                await this.updatePaymentStatus(paymentId, 'FAILED');
            } catch (updateError) {
                console.error('[PAYMENT_SERVICE] Error marking payment as failed:', updateError);
            }
            
            return false;
        }
    }

    /**
     * Cancel a pending payment
     * @param paymentId - The payment ID
     */
    async cancelPayment(paymentId: number): Promise<boolean> {
        try {
            console.log(`[PAYMENT_SERVICE] Cancelling payment ${paymentId}`);
            
            await this.updatePaymentStatus(paymentId, 'FAILED');
            return true;
        } catch (error) {
            console.error('[PAYMENT_SERVICE] Payment cancellation error:', error);
            return false;
        }
    }

    /**
     * Get the card number for payments
     */
    getCardNumber(): string {
        return this.cardNumber;
    }

    /**
     * Get the admin user ID
     */
    getAdminUserId(): string {
        return this.adminUserId;
    }

    /**
     * Format amount for display
     * @param amount - The amount in Rials
     */
    formatAmount(amount: number): string {
        return new Intl.NumberFormat('fa-IR').format(amount) + ' تومان';
    }

    isValidPaymentCard(cardNumber: string): boolean {
        // Remove spaces from card numbers before comparing
        const normalizedCard = cardNumber.replace(/\s+/g, '');
        const normalizedAdminCard = this.cardNumber.replace(/\s+/g, '');
        
        return normalizedCard === normalizedAdminCard;
    }

    formatCardForDisplay(cardNumber: string): string {
        const sanitized = cardNumber.replace(/\s+/g, '');
        const lastFour = sanitized.slice(-4);
        
        return `**** **** **** ${lastFour}`;
    }

    getCardLastDigits(cardNumber: string): string {
        const sanitized = cardNumber.replace(/\s+/g, '');
        return sanitized.slice(-4);
    }

    /**
     * Notify channel about payments or events
     * @param userId - User's telegram ID (optional)
     * @param userName - User's name (optional)
     * @param amount - Payment amount (optional)
     * @param paymentId - Payment ID (optional)
     * @param transactionId - Transaction ID string (optional)
     * @param customMessage - Custom message to send instead of the default payment notification (optional)
     */
    async notifyChannel(
        userId?: number, 
        userName?: string, 
        amount?: number, 
        paymentId?: number | string,
        transactionId?: string,
        customMessage?: string
    ): Promise<void> {
        if (!this.bot) {
            console.log('[CHANNEL_NOTIFY] Bot instance not provided, skipping channel notification');
            return;
        }
        
        try {
            // Get the channel ID, with proper format for supergroups
            const channelId = this.channelId ? 
                (`-100${this.channelId}`) : 
                '-1002546220251'; // Fallback
                
            console.log(`[CHANNEL_NOTIFY] Preparing to send notification to channel ${channelId}`);
            
            // Use the provided message or generate a payment notification
            let message: string;
            let keyboard: any = undefined;
            
            if (customMessage) {
                // Use custom message if provided
                message = customMessage;
                console.log(`[CHANNEL_NOTIFY] Using custom message for notification`);
            } else if (userId && userName && amount && (paymentId || transactionId)) {
                // Generate payment notification with proper transaction ID
                const txnId = transactionId || (typeof paymentId === 'number' ? 
                    this.generateTransactionId() : String(paymentId));
                    
                message = `🔔 *درخواست پرداخت جدید*\n\n` +
                    `👤 کاربر: *${userName}*\n` +
                    `💰 مبلغ: *${this.formatAmount(amount)}*\n` + 
                    `🧾 شناسه تراکنش: \`${txnId}\`\n\n` +
                    `⏱ تاریخ: _${new Date().toLocaleDateString('fa-IR')}_`;
                
                const pid =
                    typeof paymentId === 'number' ? paymentId : Number(paymentId);
                keyboard = {
                    inline_keyboard: [
                        [
                            { text: '✅ تایید پرداخت', callback_data: `ap:${pid}` },
                            { text: '❌ رد پرداخت', callback_data: `rj:${pid}` },
                        ],
                        [{ text: '📞 تماس با کاربر', callback_data: `contact_user:${userId}` }],
                    ],
                };
                console.log(`[CHANNEL_NOTIFY] Generated payment notification for transaction: ${txnId}`);
            } else {
                console.error(`[CHANNEL_NOTIFY] Insufficient data for notification, need either customMessage or complete payment details`);
                return;
            }
            
            // Try sending to channel with proper format
            try {
                console.log(`[CHANNEL_NOTIFY] Attempting to send to channel ID: ${channelId}`);
                await this.bot.api.sendMessage(channelId, message, {
                    parse_mode: "MarkdownV2",
                    reply_markup: keyboard
                });
                console.log(`[CHANNEL_NOTIFY] Successfully sent notification to channel`);
            } catch (channelError) {
                console.error(`[CHANNEL_NOTIFY_ERROR] Failed to send to channel: ${channelError instanceof Error ? channelError.message : String(channelError)}`);
                
                // Try sending to admin as a fallback
                if (this.adminUserId) {
                    try {
                        console.log(`[CHANNEL_NOTIFY] Fallback: Sending to admin user: ${this.adminUserId}`);
                        await this.bot.api.sendMessage(this.adminUserId, message, {
                            parse_mode: "MarkdownV2",
                            reply_markup: keyboard
                        });
                        console.log(`[CHANNEL_NOTIFY] Successfully sent to admin user as fallback`);
                    } catch (adminError) {
                        console.error(`[CHANNEL_NOTIFY_ERROR] Even admin fallback failed: ${adminError instanceof Error ? adminError.message : String(adminError)}`);
                    }
                } else {
                    console.error(`[CHANNEL_NOTIFY_ERROR] No admin user ID available for fallback notification`);
                }
            }
            
            console.log(`[CHANNEL_NOTIFY] Notification processing completed`);
        } catch (error) {
            console.error(`[CHANNEL_NOTIFY_ERROR] Failed to process notification: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get payment by transaction ID
     * @param transactionId - The transaction ID
     * @returns Payment or null if not found
     */
    async getPaymentByTransactionId(transactionId: string): Promise<Payment | null> {
        try {
            console.log(`[PAYMENT_SERVICE] Fetching payment with transaction ID ${transactionId}`);
            
            const { data: payment, error } = await this.supabase
                .from('payments')
                .select('*')
                .eq('transaction_id', transactionId)
                .single();
            
            if (error) {
                if (error.code === 'PGRST116') {
                    console.log(`[PAYMENT_SERVICE] No payment found with transaction ID ${transactionId}`);
                    return null;
                }
                console.error(`[DB_ERROR] Error fetching payment by transaction ID: ${error.message}`, error);
                throw new Error(`Failed to fetch payment by transaction ID: ${error.message}`);
            }
            
            console.log(`[PAYMENT_SERVICE] Found payment with transaction ID: ${transactionId}, payment ID: ${payment.id}`);
            return payment;
        } catch (error) {
            console.error('[DB_ERROR] Payment fetch by transaction ID error:', error);
            throw error;
        }
    }
} 