import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

const KEY_CARD = 'card_number';
const KEY_SUPPORT_CHANNEL = 'support_channel';

/**
 * Key/value settings stored in Supabase (editable via admin bot).
 */
export class SettingsService {
    constructor(private supabase: SupabaseClient<Database>) {}

    async get(key: string): Promise<string | null> {
        const { data, error } = await this.supabase
            .from('app_settings')
            .select('value')
            .eq('key', key)
            .maybeSingle();
        if (error) {
            console.error(`[SETTINGS] get ${key}:`, error);
            return null;
        }
        return data?.value ?? null;
    }

    async set(key: string, value: string): Promise<void> {
        const { error } = await this.supabase.from('app_settings').upsert(
            { key, value, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
        );
        if (error) throw new Error(`Failed to set ${key}: ${error.message}`);
    }

    async getCardNumber(fallback: string): Promise<string> {
        const v = await this.get(KEY_CARD);
        return v?.trim() || fallback;
    }

    async setCardNumber(card: string): Promise<void> {
        await this.set(KEY_CARD, card.trim());
    }

    async getSupportChannel(fallback: string): Promise<string> {
        const v = await this.get(KEY_SUPPORT_CHANNEL);
        return v?.trim() || fallback;
    }

    async setSupportChannel(value: string): Promise<void> {
        await this.set(KEY_SUPPORT_CHANNEL, value.trim());
    }
}
