import { SupabaseClient } from '@supabase/supabase-js';
import type { Database, AccountInventory } from '../types';

export class InventoryService {
    private productTypes: ProductTypeService;

    constructor(private supabase: SupabaseClient<Database>) {
        this.productTypes = new ProductTypeService(supabase);
    }

    /**
     * Pick oldest available row matching plan_key (NULL means any plan).
     */
    async takeNextForPlan(plan: string): Promise<AccountInventory | null> {
        const { data, error } = await this.supabase
            .from('account_inventory')
            .select('*')
            .eq('status', 'available')
            .is('product_type_id', null)
            .or(`plan_key.is.null,plan_key.eq.${plan}`)
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('[INVENTORY] takeNextForPlan:', error);
            throw new Error(error.message);
        }
        return data;
    }

    async markSold(
        inventoryId: number,
        userId: number,
        paymentId: number
    ): Promise<void> {
        const { error } = await this.supabase
            .from('account_inventory')
            .update({
                status: 'sold',
                sold_user_id: userId,
                sold_payment_id: paymentId,
                sold_at: new Date().toISOString(),
            })
            .eq('id', inventoryId)
            .eq('status', 'available');

        if (error) throw new Error(`markSold: ${error.message}`);
    }

    /** Undo markSold if VPN row creation failed */
    async releaseBack(inventoryId: number): Promise<void> {
        const { error } = await this.supabase
            .from('account_inventory')
            .update({
                status: 'available',
                sold_user_id: null,
                sold_payment_id: null,
                sold_at: null,
            })
            .eq('id', inventoryId);
        if (error) console.error('[INVENTORY] releaseBack:', error);
    }

    async addRow(input: {
        username: string;
        password: string;
        plan_key?: string | null;
        config_format?: string;
        config_text?: string | null;
        config_file_id?: string | null;
    }): Promise<AccountInventory> {
        const { data, error } = await this.supabase
            .from('account_inventory')
            .insert({
                username: input.username.trim(),
                password: input.password.trim(),
                plan_key: input.plan_key ?? null,
                product_type_id: input.product_type_id ?? null,
                config_format: input.config_format ?? 'openvpn',
                config_text: input.config_text ?? null,
                config_file_id: input.config_file_id ?? null,
                status: 'available',
            })
            .select()
            .single();

        if (error) throw new Error(`addRow: ${error.message}`);
        return data;
    }

    async countAvailable(plan?: string): Promise<number> {
        let q = this.supabase
            .from('account_inventory')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'available');

        if (plan) {
            q = q.or(`plan_key.is.null,plan_key.eq.${plan}`);
        }

        const { count, error } = await q;
        if (error) throw new Error(error.message);
        return count ?? 0;
    }

    /** Available rows tied to a catalog product type id. */
    async countAvailableForProductTypeId(productTypeId: number): Promise<number> {
        const { count, error } = await this.supabase
            .from('account_inventory')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'available')
            .eq('product_type_id', productTypeId);

        if (error) throw new Error(error.message);
        return count ?? 0;
    }

    async updateConfig(
        id: number,
        patch: Partial<
            Pick<
                AccountInventory,
                'config_text' | 'config_file_id' | 'config_format'
            >
        >
    ): Promise<void> {
        const { error } = await this.supabase
            .from('account_inventory')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw new Error(error.message);
    }

    async getById(id: number): Promise<AccountInventory | null> {
        const { data, error } = await this.supabase
            .from('account_inventory')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data;
    }

    planExpiryFromPurchase(days: number): Date {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d;
    }

    getProductTypes(): ProductTypeService {
        return this.productTypes;
    }
}
