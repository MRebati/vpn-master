import { SupabaseClient } from '@supabase/supabase-js';
import { Database, VpnAccount } from '../types';
import crypto from 'crypto';

/**
 * Service class for managing VPN accounts
 */
export class VpnAccountService {
    private supabase: SupabaseClient<Database>;

    constructor(supabaseClient: SupabaseClient<Database>) {
        this.supabase = supabaseClient;
    }

    private farFutureExpiryIso(): string {
        // Renewal/expiry control is disabled in current product flow.
        // Keep accounts active with a stable far-future date.
        return new Date('2099-12-31T00:00:00.000Z').toISOString();
    }

    /**
     * Create VPN account row (from inventory pool).
     */
    async createVpnAccount(
        userId: number,
        username: string,
        password: string,
        plan: string,
        _planDurationDays: number,
        opts?: {
            inventory_id?: number | null;
            config_format?: string | null;
            expiryDateIso?: string | null;
        }
    ): Promise<VpnAccount> {
        try {
            console.log(`[VPN_SERVICE] Creating VPN account for user ${userId} with plan ${plan}`);

            const { data: account, error } = await this.supabase
                .from('vpn_accounts')
                .insert({
                    user_id: userId,
                    username,
                    password,
                    plan,
                    expiry_date: opts?.expiryDateIso ?? this.farFutureExpiryIso(),
                    is_active: true,
                    inventory_id: opts?.inventory_id ?? null,
                    config_format: opts?.config_format ?? null,
                })
                .select()
                .single();

            if (error) {
                console.error(`[DB_ERROR] Error creating VPN account: ${error.message}`, error);
                throw new Error(`Failed to create VPN account: ${error.message}`);
            }

            console.log(`[VPN_SERVICE] Created VPN account ID: ${account.id} for user ${userId}`);
            return account;
        } catch (error) {
            console.error('[DB_ERROR] VPN account creation error:', error);
            throw error;
        }
    }

    async listAccountsForUser(userId: number): Promise<VpnAccount[]> {
        const { data, error } = await this.supabase
            .from('vpn_accounts')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);
        return data ?? [];
    }

    /**
     * Get VPN account by user ID
     */
    async getVpnAccountByUserId(userId: number): Promise<VpnAccount | null> {
        try {
            console.log(`[VPN_SERVICE] Fetching VPN account for user ${userId}`);

            const { data: account, error } = await this.supabase
                .from('vpn_accounts')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) {
                console.error(`[DB_ERROR] Error fetching VPN account: ${error.message}`, error);
                throw new Error(`Failed to fetch VPN account: ${error.message}`);
            }

            return account;
        } catch (error) {
            console.error('[DB_ERROR] VPN account fetch error:', error);
            throw error;
        }
    }

    /**
     * Get VPN account by ID
     */
    async getVpnAccountById(accountId: number): Promise<VpnAccount | null> {
        try {
            console.log(`[VPN_SERVICE] Fetching VPN account with ID ${accountId}`);

            const { data: account, error } = await this.supabase
                .from('vpn_accounts')
                .select('*')
                .eq('id', accountId)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    console.log(`[VPN_SERVICE] No VPN account found with ID ${accountId}`);
                    return null;
                }
                console.error(`[DB_ERROR] Error fetching VPN account: ${error.message}`, error);
                throw new Error(`Failed to fetch VPN account: ${error.message}`);
            }

            console.log(`[VPN_SERVICE] Found VPN account ID: ${accountId}`);
            return account;
        } catch (error) {
            console.error('[DB_ERROR] VPN account fetch error:', error);
            throw error;
        }
    }

    /**
     * Update the expiry date of a VPN account based on a plan
     */
    async extendVpnAccount(accountId: number, plan: string, planDurationDays: number): Promise<void> {
        try {
            console.log(
                `[VPN_SERVICE] Renewal is disabled; forcing active far-future expiry for account ${accountId} (requested plan=${plan}, days=${planDurationDays})`
            );

            const { data: currentAccount, error: fetchError } = await this.supabase
                .from('vpn_accounts')
                .select('*')
                .eq('id', accountId)
                .single();

            if (fetchError) {
                console.error(`[DB_ERROR] Error fetching VPN account: ${fetchError.message}`, fetchError);
                throw new Error(`VPN account with ID ${accountId} not found`);
            }

            const forcedExpiry = this.farFutureExpiryIso();

            const { error: updateError } = await this.supabase
                .from('vpn_accounts')
                .update({
                    expiry_date: forcedExpiry,
                    is_active: true,
                })
                .eq('id', accountId);

            if (updateError) {
                console.error(`[DB_ERROR] Error extending VPN account: ${updateError.message}`, updateError);
                throw new Error(`Failed to extend VPN account: ${updateError.message}`);
            }

            console.log(`[VPN_SERVICE] Successfully forced VPN account ${accountId} expiry to ${forcedExpiry}`);
        } catch (error) {
            console.error('[DB_ERROR] VPN account extension error:', error);
            throw error;
        }
    }

    async updateAccountStatus(accountId: number, isActive: boolean): Promise<void> {
        try {
            console.log(`[VPN_SERVICE] Updating VPN account ${accountId} status to ${isActive ? 'active' : 'inactive'}`);

            const { error } = await this.supabase
                .from('vpn_accounts')
                .update({ is_active: isActive })
                .eq('id', accountId);

            if (error) {
                console.error(`[DB_ERROR] Error updating VPN account status: ${error.message}`, error);
                throw new Error(`Failed to update VPN account status: ${error.message}`);
            }

            console.log(`[VPN_SERVICE] Successfully updated VPN account ${accountId} status to ${isActive ? 'active' : 'inactive'}`);
        } catch (error) {
            console.error('[DB_ERROR] VPN account status update error:', error);
            throw error;
        }
    }

    generatePassword(length: number = 12): string {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
        const randomBytes = crypto.randomBytes(length);
        let password = '';

        for (let i = 0; i < length; i++) {
            const index = randomBytes[i] % characters.length;
            password += characters.charAt(index);
        }

        return password;
    }

    /**
     * Check if a username is available in inventory / sold accounts
     */
    async isUsernameAvailable(username: string): Promise<boolean> {
        try {
            console.log(`[VPN_SERVICE] Checking if username ${username} is available`);

            const { data, error } = await this.supabase
                .from('vpn_accounts')
                .select('id')
                .eq('username', username)
                .maybeSingle();

            if (error) {
                console.error(`[DB_ERROR] Error checking username availability: ${error.message}`, error);
                throw new Error(`Failed to check username availability: ${error.message}`);
            }

            const isAvailable = data === null;
            console.log(`[VPN_SERVICE] Username ${username} is ${isAvailable ? 'available' : 'not available'}`);
            return isAvailable;
        } catch (error) {
            console.error('[DB_ERROR] Username availability check error:', error);
            throw error;
        }
    }
}
