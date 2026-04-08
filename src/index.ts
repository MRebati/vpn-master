import { BotManager } from './bot/botManager';
import { AdminBotManager } from './bot/adminBotManager';
import { UserStep } from './constants';
export { EXTENDED_MESSAGES } from './extendedMessages';

// Define environment interface
export interface Env {
    /** Customer-facing bot token (sends receipts & accounts). */
    BOT_TOKEN: string;
    /** Optional: admin bot webhook at `POST /admin` — inventory, card, manual delivery. */
    ADMIN_BOT_TOKEN?: string;
    /** Comma-separated Telegram user IDs allowed to approve payments & use admin bot (DM / any chat). */
    STAFF_USER_IDS?: string;
    /**
     * Numeric id of the private staff supergroup (same format as CHANNEL_ID, no -100 prefix).
     * Anyone who can post there is treated as staff for messages & inline buttons in that chat.
     */
    STAFF_CHANNEL_ID?: string;
    SUPABASE_URL: string;
    /**
     * Prefer a service role key for server-side Workers.
     * `SUPABASE_KEY` is kept for backward compatibility.
     */
    SUPABASE_SERVICE_ROLE_KEY?: string;
    SUPABASE_KEY?: string;
    ADMIN_USER_ID: string;
    CARD_NUMBER: string;
    TEST_MODE?: string; // "true" to enable test mode
    CHANNEL_ID?: string; // Channel ID for notifications
}

// Helper functions for generating VPN credentials
export function generateVpnUsername(): string {
  return `vpn_user_${Math.floor(Math.random() * 100000)}`;
}

export function generateVpnPassword(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Main handler
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // Log the incoming request details
        console.log(`[REQUEST] ${request.method} ${request.url}`);
        console.log(`[REQUEST_HEADERS] ${JSON.stringify(Object.fromEntries([...request.headers]))}`);
        
        try {
            const url = new URL(request.url);
            const isAdminWebhook =
                url.pathname === '/admin' ||
                url.pathname.endsWith('/admin');

            if (isAdminWebhook) {
                if (!env.ADMIN_BOT_TOKEN) {
                    return new Response('Admin bot not configured', { status: 404 });
                }
                if (request.method !== 'POST') {
                    return new Response('Method not allowed', { status: 405 });
                }
                const adminBot = new AdminBotManager(env);
                const rawBody = await request.text();
                const update = JSON.parse(rawBody);
                const ok = await adminBot.processUpdate(update);
                return new Response(ok ? 'OK' : 'Failed', { status: ok ? 200 : 500 });
            }

            // Initialize the bot manager
            console.log(`[BOT_INIT] Initializing BotManager`);
            const botManager = new BotManager(env);
            
            // Only accept POST requests
            if (request.method !== 'POST') {
                console.log(`[REQUEST_REJECTED] Method not allowed: ${request.method}`);
                return new Response('Method not allowed', { status: 405 });
            }
            
            // Clone the request to read its body multiple times if needed
            const clonedRequest = request.clone();
            
            // Log the raw request body for debugging
            const rawBody = await clonedRequest.text();
            console.log(`[WEBHOOK_RAW] Received webhook data (${rawBody.length} bytes)`);
            console.log(`[WEBHOOK_DATA] ${rawBody.substring(0, 1000)}${rawBody.length > 1000 ? '...' : ''}`);
            
            try {
                // Parse the webhook data
                const update = JSON.parse(rawBody);
                console.log(`[WEBHOOK_PARSED] Successfully parsed webhook data`);
                
                // Log update type information
                if (update.message) {
                    console.log(`[MESSAGE_RECEIVED] From: ${update.message.from?.id} (${update.message.from?.first_name || 'Unknown'})`);
                    if (update.message.text) {
                        console.log(`[MESSAGE_TEXT] ${update.message.text}`);
                    } else if (update.message.photo) {
                        console.log(`[MESSAGE_PHOTO] Received photo`);
                    } else {
                        console.log(`[MESSAGE_OTHER] Received non-text message type: ${Object.keys(update.message).filter(k => !['from', 'chat', 'date', 'message_id'].includes(k)).join(', ')}`);
                    }
                } else if (update.callback_query) {
                    console.log(`[CALLBACK_QUERY] From: ${update.callback_query.from.id}, Data: ${update.callback_query.data}`);
                } else {
                    console.log(`[UPDATE_TYPE] Received update type: ${Object.keys(update).join(', ')}`);
                }
                
                // Process the update
                console.log(`[PROCESS_START] Starting update processing`);
                const success = await botManager.processUpdate(update);
                console.log(`[PROCESS_RESULT] Update processing ${success ? 'successful' : 'failed'}`);
                
                return new Response(success ? 'OK' : 'Failed to process update', {
                    status: success ? 200 : 500,
                });
            } catch (error) {
                // Log parsing or processing errors
                console.error(`[WEBHOOK_ERROR] Error processing webhook:`, error);
                console.error(`[WEBHOOK_STACK] ${error.stack || 'No stack trace available'}`);
                
                // Try to get webhook info to diagnose issues
                try {
                    console.log(`[WEBHOOK_DIAGNOSIS] Attempting to check webhook status`);
                    const webhookInfo = await botManager.getWebhookInfo();
                    console.log(`[WEBHOOK_INFO] Current webhook configuration:`, webhookInfo);
                } catch (infoError) {
                    console.error(`[WEBHOOK_INFO_ERROR] Failed to get webhook info:`, infoError);
                }
                
                return new Response(`Error processing webhook: ${error.message}`, {
                    status: 500,
                });
            }
        } catch (error) {
            // Log initialization errors
            console.error(`[INIT_ERROR] Error initializing bot:`, error);
            console.error(`[INIT_STACK] ${error.stack || 'No stack trace available'}`);
            
            return new Response(`Error initializing bot: ${error.message}`, {
                status: 500,
            });
        }
    }
};

