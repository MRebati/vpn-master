import { SupabaseClient } from '@supabase/supabase-js';
import type { Database, VpnProductType } from '../types';

export class ProductTypeService {
    constructor(private supabase: SupabaseClient<Database>) {}

    async listActive(): Promise<VpnProductType[]> {
        const { data, error } = await this.supabase
            .from('vpn_product_types')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('id', { ascending: true });

        if (error) throw new Error(error.message);
        return data ?? [];
    }

    async listAll(): Promise<VpnProductType[]> {
        const { data, error } = await this.supabase
            .from('vpn_product_types')
            .select('*')
            .order('sort_order', { ascending: true })
            .order('id', { ascending: true });

        if (error) throw new Error(error.message);
        return data ?? [];
    }

    async getById(id: number): Promise<VpnProductType | null> {
        const { data, error } = await this.supabase
            .from('vpn_product_types')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data;
    }

    async getActiveBySlug(slug: string): Promise<VpnProductType | null> {
        const { data, error } = await this.supabase
            .from('vpn_product_types')
            .select('*')
            .eq('slug', slug.trim())
            .eq('is_active', true)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data;
    }

    async getBySlugAny(slug: string): Promise<VpnProductType | null> {
        const { data, error } = await this.supabase
            .from('vpn_product_types')
            .select('*')
            .eq('slug', slug.trim())
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data;
    }

    async create(input: {
        slug: string;
        label_fa: string;
        unit: 'days' | 'gb';
        metric_value: number;
        price_toman?: number | null;
        sort_order?: number;
    }): Promise<VpnProductType> {
        const slug = input.slug.trim().replace(/\s+/g, '_').toLowerCase();
        const { data, error } = await this.supabase
            .from('vpn_product_types')
            .insert({
                slug,
                label_fa: input.label_fa.trim(),
                unit: input.unit,
                metric_value: input.metric_value,
                price_toman: input.price_toman ?? null,
                sort_order: input.sort_order ?? 0,
                is_active: true,
            })
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data;
    }

    async setActive(id: number, isActive: boolean): Promise<void> {
        const { error } = await this.supabase
            .from('vpn_product_types')
            .update({ is_active: isActive })
            .eq('id', id);
        if (error) throw new Error(error.message);
    }
}
