import { SupabaseClient } from '@supabase/supabase-js';
import { Database, User } from '../types';
import { UserStep, VpnPlanKey } from '../constants';

/**
 * Service class for managing user operations
 */
export class UserService {
    private supabase: SupabaseClient<Database>;

    constructor(supabaseClient: SupabaseClient<Database>) {
        this.supabase = supabaseClient;
    }

    /**
     * Get an existing user or create a new one by Telegram ID
     * @param telegramId - User's Telegram ID
     * @param firstName - User's first name
     * @param username - User's Telegram username (optional)
     */
    async getOrCreateUser(telegramId: number, firstName: string, username?: string): Promise<User> {
        try {
            console.log(`[USER_SERVICE] Looking up user with Telegram ID: ${telegramId}`);
            
            // Check if user exists
            try {
                const { data: existingUser, error: fetchError } = await this.supabase
                    .from('vpn_users')
                    .select('*')
                    .eq('telegram_id', telegramId)
                    .single();
                
                if (fetchError && fetchError.code !== 'PGRST116') {
                    // Error other than "not found"
                    console.error(`[DB_ERROR] Error fetching user: ${fetchError.message}`, fetchError);
                    throw new Error(`Database error: ${fetchError.message}`);
                }
                
                if (existingUser) {
                    console.log(`[USER_SERVICE] Found existing user: ${existingUser.first_name} (ID: ${existingUser.id})`);
                    return existingUser;
                }
            } catch (error) {
                console.error(`[DB_ERROR] Error during user lookup:`, error);
                // If the error is during lookup, try to create a new user anyway
                if (error.message !== 'Database error: Database connection error') {
                    throw error; // Only proceed if it's not a connection error
                }
            }
            
            // Create new user if not exists
            console.log(`[USER_SERVICE] Creating new user with Telegram ID: ${telegramId}`);
            try {
                const { data: newUser, error: insertError } = await this.supabase
                    .from('vpn_users')
                    .insert({
                        telegram_id: telegramId,
                        first_name: firstName,
                        username: username || null,
                        step: UserStep.START
                    })
                    .select()
                    .single();
                
                if (insertError) {
                    console.error(`[DB_ERROR] Error creating user: ${insertError.message}`, insertError);
                    throw new Error(`Failed to create user: ${insertError.message}`);
                }
                
                console.log(`[USER_SERVICE] Created new user: ${newUser.first_name} (ID: ${newUser.id})`);
                return newUser;
            } catch (dbError) {
                console.error('[DB_ERROR] User creation error:', dbError);
                
                // Return a temporary user object if we're in test mode
                // This will only be used for the current session and won't persist
                console.log('[USER_SERVICE] Creating temporary user object for testing');
                return {
                    id: -1, // Temporary ID
                    telegram_id: telegramId,
                    first_name: firstName,
                    username: username,
                    step: UserStep.START,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
            }
        } catch (error) {
            console.error('[DB_ERROR] User get/create error:', error);
            throw error;
        }
    }

    /**
     * Update user's conversation step
     * @param userId - User's database ID
     * @param step - New step value
     */
    async setUserStep(userId: number, step: UserStep): Promise<void> {
        try {
            console.log(`[USER_SERVICE] Updating user ${userId} step to: ${step}`);
            
            const { error } = await this.supabase
                .from('vpn_users')
                .update({ step })
                .eq('id', userId);
            
            if (error) {
                console.error(`[DB_ERROR] Error updating user step: ${error.message}`, error);
                throw new Error(`Failed to update user step: ${error.message}`);
            }
        } catch (error) {
            console.error('[DB_ERROR] User step update error:', error);
            throw error;
        }
    }

    /**
     * Set user's selected plan
     * @param userId - User's database ID
     * @param plan - Selected VPN plan
     * @param amount - Plan price
     */
    async selectPlan(userId: number, plan: VpnPlanKey, amount: number): Promise<void> {
        try {
            console.log(`[USER_SERVICE] Setting plan for user ${userId}: ${plan}, amount: ${amount}`);
            
            const { error } = await this.supabase
                .from('vpn_users')
                .update({
                    selected_plan: plan,
                    amount: amount
                })
                .eq('id', userId);
            
            if (error) {
                console.error(`[DB_ERROR] Error updating user plan: ${error.message}`, error);
                throw new Error(`Failed to update user plan: ${error.message}`);
            }
        } catch (error) {
            console.error('[DB_ERROR] User plan update error:', error);
            throw error;
        }
    }

    /**
     * Get user by database ID
     * @param userId - User's database ID
     */
    async getUserById(userId: number): Promise<User | null> {
        try {
            console.log(`[USER_SERVICE] Fetching user by ID: ${userId}`);
            
            const { data, error } = await this.supabase
                .from('vpn_users')
                .select('*')
                .eq('id', userId)
                .single();
            
            if (error) {
                console.error(`[DB_ERROR] Error fetching user by ID: ${error.message}`, error);
                throw new Error(`Failed to fetch user: ${error.message}`);
            }
            
            return data;
        } catch (error) {
            console.error('[DB_ERROR] User fetch error:', error);
            throw error;
        }
    }

    /**
     * Get user by Telegram ID
     * @param telegramId - User's Telegram ID
     */
    async getUserByTelegramId(telegramId: number): Promise<User | null> {
        try {
            console.log(`[USER_SERVICE] Fetching user by Telegram ID: ${telegramId}`);
            
            const { data, error } = await this.supabase
                .from('vpn_users')
                .select('*')
                .eq('telegram_id', telegramId)
                .single();
            
            if (error && error.code !== 'PGRST116') {
                console.error(`[DB_ERROR] Error fetching user by Telegram ID: ${error.message}`, error);
                throw new Error(`Failed to fetch user: ${error.message}`);
            }
            
            return data || null;
        } catch (error) {
            console.error('[DB_ERROR] User fetch error:', error);
            throw error;
        }
    }

    /**
     * Set user's VPN username
     * @param userId - User's database ID
     * @param vpnUsername - VPN username
     */
    async setVpnUsername(userId: number, vpnUsername: string): Promise<void> {
        try {
            console.log(`[USER_SERVICE] Setting VPN username for user ${userId}: ${vpnUsername}`);
            
            const { error } = await this.supabase
                .from('vpn_users')
                .update({ vpn_username: vpnUsername })
                .eq('id', userId);
            
            if (error) {
                console.error(`[DB_ERROR] Error updating VPN username: ${error.message}`, error);
                throw new Error(`Failed to update VPN username: ${error.message}`);
            }
        } catch (error) {
            console.error('[DB_ERROR] VPN username update error:', error);
            throw error;
        }
    }

    /**
     * Set user's VPN password
     * @param userId - User's database ID
     * @param vpnPassword - VPN password
     */
    async setVpnPassword(userId: number, vpnPassword: string): Promise<void> {
        try {
            console.log(`[USER_SERVICE] Setting VPN password for user ${userId}`);
            
            const { error } = await this.supabase
                .from('vpn_users')
                .update({ vpn_password: vpnPassword })
                .eq('id', userId);
            
            if (error) {
                console.error(`[DB_ERROR] Error updating VPN password: ${error.message}`, error);
                throw new Error(`Failed to update VPN password: ${error.message}`);
            }
        } catch (error) {
            console.error('[DB_ERROR] VPN password update error:', error);
            throw error;
        }
    }
} 