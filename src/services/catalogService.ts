import { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PaymentMethodKind, PublicPaymentMethod, PublicPlan } from '../types';

type DbRecord = Record<string, unknown>;

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function asString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return null;
}

function normalizeKind(kind: unknown): PaymentMethodKind {
    const value = asString(kind)?.toLowerCase();
    if (value === 'rial_card' || value === 'ton' || value === 'crypto') return value;
    return 'other';
}

export class CatalogService {
    private readonly supabase: SupabaseClient<Database>;
    private dbBackedCatalogEnabled: boolean | null = null;

    constructor(supabase: SupabaseClient<Database>) {
        this.supabase = supabase;
    }

    /**
     * Check whether database has catalog tables.
     */
    private async hasDbCatalog(): Promise<boolean> {
        if (this.dbBackedCatalogEnabled !== null) return this.dbBackedCatalogEnabled;
        try {
            const { error } = await this.supabase
                .from('product_types' as never)
                .select('id', { head: true, count: 'exact' })
                .limit(1);
            this.dbBackedCatalogEnabled = !error;
        } catch {
            this.dbBackedCatalogEnabled = false;
        }
        return this.dbBackedCatalogEnabled;
    }

    async listVisiblePlans(): Promise<PublicPlan[]> {
        if (!(await this.hasDbCatalog())) return [];

        const { data, error } = await this.supabase
            .from('product_types' as never)
            .select('*')
            .eq('is_catalog_visible', true)
            .order('id', { ascending: true });

        if (error || !Array.isArray(data) || data.length === 0) return [];

        const rows = data as unknown as DbRecord[];
        const mapped = rows
            .map((row) => this.mapPlanRow(row))
            .filter((p): p is PublicPlan => Boolean(p))
            .filter((p) => p.isCatalogVisible);

        return mapped;
    }

    async getPlanBySlug(slug: string): Promise<PublicPlan | null> {
        const plans = await this.listVisiblePlans();
        return plans.find((p) => p.slug === slug) ?? null;
    }

    async getPlanByInternalPlanKey(planKey: string): Promise<PublicPlan | null> {
        const plans = await this.listVisiblePlans();
        return plans.find((p) => p.internalPlanKey === planKey) ?? null;
    }

    async getPlanMetricDaysByPlanKey(planKey: string): Promise<number | null> {
        const plan = await this.getPlanByInternalPlanKey(planKey);
        if (!plan) return null;
        if (plan.unit !== 'days') return null;
        const days = Number(plan.metricValue);
        if (!Number.isFinite(days) || days <= 0) return null;
        return days;
    }

    async getPaymentMethodsForPlan(
        plan: PublicPlan,
        fallbackCardNumber: string
    ): Promise<PublicPaymentMethod[]> {
        if (!(await this.hasDbCatalog()) || !plan.productTypeId) return [];

        const { data, error } = await this.supabase
            .from('product_type_payment_methods' as never)
            .select('*')
            .eq('product_type_id', plan.productTypeId)
            .eq('is_active', true)
            .order('id', { ascending: true });

        if (error || !Array.isArray(data) || data.length === 0) return [];

        const rows = data as unknown as DbRecord[];
        return rows.map((row) => this.mapPaymentMethodRow(row, plan.productTypeId!, fallbackCardNumber));
    }

    private mapPlanRow(row: DbRecord): PublicPlan | null {
        const id = asNumber(row.id);
        if (!id) return null;

        const internalPlanKey = asString(row.plan_key) ?? asString(row.slug) ?? asString(row.code);
        if (!internalPlanKey) return null;

        const slug =
            asString(row.slug) ??
            asString(row.code) ??
            asString(row.plan_key) ??
            `${internalPlanKey}-${id}`;
        const title =
            asString(row.label_fa) ??
            asString(row.labelFa) ??
            asString(row.title) ??
            slug;
        const unitValue = asString(row.unit)?.toLowerCase();
        const unit: 'days' | 'gb' = unitValue === 'gb' ? 'gb' : 'days';
        const metricValue =
            asNumber(row.metric_value) ??
            asNumber(row.metricValue) ??
            asNumber(row.days) ??
            0;
        const priceToman =
            asNumber(row.price_toman) ??
            asNumber(row.priceToman) ??
            asNumber(row.price) ??
            0;
        const isCatalogVisible = asBoolean(row.is_catalog_visible) ?? true;
        const rating = asNumber(row.rating);
        const guidelineText =
            asString(row.guideline_text) ?? asString(row.guidelineText) ?? null;
        const productTypeId =
            asNumber(row.product_type_id) ??
            asNumber(row.productTypeId) ??
            id;

        return {
            id,
            slug,
            title,
            unit,
            metricValue,
            priceToman,
            rating,
            guidelineText,
            isCatalogVisible,
            internalPlanKey,
            productTypeId,
        };
    }

    private mapPaymentMethodRow(
        row: DbRecord,
        productTypeId: number,
        fallbackCardNumber: string
    ): PublicPaymentMethod {
        const id = asNumber(row.id) ?? 1;
        const kind = normalizeKind(row.kind ?? row.method_kind ?? row.payment_kind);
        const label =
            asString(row.label) ??
            asString(row.title) ??
            (kind === 'rial_card'
                ? 'کارت به کارت'
                : kind === 'ton'
                  ? 'TON'
                  : kind === 'crypto'
                    ? 'Crypto'
                    : 'پرداخت');
        const payToValue =
            asString(row.pay_to_value) ??
            asString(row.payto) ??
            asString(row.destination) ??
            (kind === 'rial_card' ? fallbackCardNumber : null);
        const instructions = asString(row.instructions) ?? null;

        return {
            id,
            productTypeId,
            kind,
            label,
            payToValue,
            instructions,
            metadata: {
                network: asString(row.network),
                chain: asString(row.chain),
            },
        };
    }
}
