import { SupabaseClient } from '@supabase/supabase-js';
import type { Database, AccountInventory } from '../types';
import { ProductTypeService } from './productTypeService';

export class InventoryService {
    private productTypes: ProductTypeService;

    constructor(private supabase: SupabaseClient<Database>) {
        this.productTypes = new ProductTypeService(supabase);
    }

    /**
     * Pick oldest available row matching product type / supplier / plan.
     * Priority:
     * 1) exact product_type_id
     * 2) supplier-bound generic stock (product_type_id null)
     * 3) legacy generic stock by plan_key (product_type_id null)
     */
    async takeNextForPlan(
        input:
            | string
            | {
                  planKey: string;
                  productTypeId?: number | null;
                  supplierId?: number | null;
              },
        options?: { productTypeId?: number | null; supplierId?: number | null }
    ): Promise<AccountInventory | null> {
        const criteria =
            typeof input === 'string'
                ? {
                      planKey: input,
                      productTypeId: options?.productTypeId ?? null,
                      supplierId: options?.supplierId ?? null,
                  }
                : {
                      planKey: input.planKey,
                      productTypeId: input.productTypeId ?? null,
                      supplierId: input.supplierId ?? null,
                  };

        const plan = criteria.planKey;
        const productTypeId = criteria.productTypeId;
        if (productTypeId) {
            const { data, error } = await this.supabase
                .from('account_inventory')
                .select('*')
                .eq('status', 'available')
                .eq('product_type_id', productTypeId)
                .order('id', { ascending: true })
                .limit(1)
                .maybeSingle();
            if (error) {
                console.error('[INVENTORY] takeNextForPlan product_type_id:', error);
                throw new Error(error.message);
            }
            if (data) return data;
        }

        const supplierId = criteria.supplierId;
        if (supplierId) {
            const { data, error } = await this.supabase
                .from('account_inventory')
                .select('*')
                .eq('status', 'available')
                .eq('supplier_id' as never, supplierId as never)
                .is('product_type_id', null)
                .or(`plan_key.is.null,plan_key.eq.${plan}`)
                .order('id', { ascending: true })
                .limit(1)
                .maybeSingle();
            if (error) {
                // Keep compatibility with deployments that don't have supplier_id on inventory yet.
                console.warn('[INVENTORY] supplier-aware fallback skipped:', error.message);
            } else if (data) {
                return data;
            }
        }

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
            console.error('[INVENTORY] takeNextForPlan legacy:', error);
            throw new Error(error.message);
        }
        return data;
    }

    /**
     * True if {@link takeNextForPlan} would return a row (without consuming stock).
     * Uses the same priority: product_type_id → supplier generic → legacy plan_key generic.
     */
    async hasAvailableForPlan(input: {
        planKey: string;
        productTypeId?: number | null;
        supplierId?: number | null;
    }): Promise<boolean> {
        const plan = input.planKey;
        const productTypeId = input.productTypeId ?? null;
        if (productTypeId) {
            const { data, error } = await this.supabase
                .from('account_inventory')
                .select('id')
                .eq('status', 'available')
                .eq('product_type_id', productTypeId)
                .order('id', { ascending: true })
                .limit(1)
                .maybeSingle();
            if (error) {
                console.error('[INVENTORY] hasAvailableForPlan product_type_id:', error);
                throw new Error(error.message);
            }
            if (data) return true;
        }

        const supplierId = input.supplierId ?? null;
        if (supplierId) {
            const { data, error } = await this.supabase
                .from('account_inventory')
                .select('id')
                .eq('status', 'available')
                .eq('supplier_id' as never, supplierId as never)
                .is('product_type_id', null)
                .or(`plan_key.is.null,plan_key.eq.${plan}`)
                .order('id', { ascending: true })
                .limit(1)
                .maybeSingle();
            if (error) {
                console.warn('[INVENTORY] hasAvailableForPlan supplier fallback skipped:', error.message);
            } else if (data) {
                return true;
            }
        }

        const { data, error } = await this.supabase
            .from('account_inventory')
            .select('id')
            .eq('status', 'available')
            .is('product_type_id', null)
            .or(`plan_key.is.null,plan_key.eq.${plan}`)
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('[INVENTORY] hasAvailableForPlan legacy:', error);
            throw new Error(error.message);
        }
        return Boolean(data);
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
        product_type_id?: number | null;
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

    async setStockMessageMeta(
        inventoryId: number,
        chatId: number,
        messageId: number
    ): Promise<void> {
        const { error } = await this.supabase
            .from('account_inventory')
            .update({
                stock_chat_id: chatId,
                stock_message_id: messageId,
                updated_at: new Date().toISOString(),
            })
            .eq('id', inventoryId);
        if (error) throw new Error(error.message);
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
