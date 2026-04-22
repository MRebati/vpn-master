import { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PaymentMethodKind, PublicPaymentMethod, PublicPlan } from '../types';

type DbRecord = Record<string, unknown>;
type CatalogSource = 'product_types' | 'vpn_product_types' | 'none';

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
    private catalogSource: CatalogSource | null = null;

    constructor(supabase: SupabaseClient<Database>) {
        this.supabase = supabase;
    }

    private async detectCatalogSource(): Promise<CatalogSource> {
        if (this.catalogSource !== null) return this.catalogSource;
        try {
            const productTypesProbe = await this.supabase
                .from('product_types' as never)
                .select('id,is_catalog_visible,is_active');
            if (!productTypesProbe.error && Array.isArray(productTypesProbe.data)) {
                const rows = productTypesProbe.data as unknown as DbRecord[];
                const hasVisible = rows.some((row) => {
                    const visibilityFlag = asBoolean(row.is_catalog_visible);
                    const activeFlag = asBoolean(row.is_active);
                    return (visibilityFlag ?? true) && (activeFlag ?? true);
                });
                if (hasVisible) {
                    this.catalogSource = 'product_types';
                    return this.catalogSource;
                }
            } else if (!productTypesProbe.error) {
                this.catalogSource = 'product_types';
                return this.catalogSource;
            }

            const legacyProbe = await this.supabase
                .from('vpn_product_types' as never)
                .select('id,is_active');
            if (!legacyProbe.error && Array.isArray(legacyProbe.data)) {
                const rows = legacyProbe.data as unknown as DbRecord[];
                const hasVisible = rows.some((row) => asBoolean(row.is_active) ?? true);
                if (hasVisible) {
                    this.catalogSource = 'vpn_product_types';
                    return this.catalogSource;
                }
            } else if (!legacyProbe.error) {
                this.catalogSource = 'vpn_product_types';
                return this.catalogSource;
            }
        } catch {
            // fall through
        }
        this.catalogSource = 'none';
        return this.catalogSource;
    }

    async listVisiblePlans(): Promise<PublicPlan[]> {
        const source = await this.detectCatalogSource();
        if (source === 'none') return [];

        if (source === 'vpn_product_types') {
            const legacyBaseQuery = this.supabase
                .from('vpn_product_types' as never)
                .select('*')
                .eq('is_active', true);
            const legacyOrderedQuery =
                typeof (legacyBaseQuery as { order?: (...args: unknown[]) => unknown }).order ===
                'function'
                    ? (legacyBaseQuery as {
                          order: (column: string, opts: { ascending: boolean }) => unknown;
                      })
                          .order('sort_order', { ascending: true })
                          // Keep deterministic output where supported by client chain.
                          ['order']('id', { ascending: true })
                    : legacyBaseQuery;
            const legacyResult = (await legacyOrderedQuery) as { data?: unknown; error?: unknown };
            const data = legacyResult.data;
            const error = legacyResult.error;

            if (error || !Array.isArray(data) || data.length === 0) return [];

            const rows = data as unknown as DbRecord[];
            return rows
                .map((row) => this.mapLegacyPlanRow(row))
                .filter((p): p is PublicPlan => Boolean(p))
                .filter((p) => p.isCatalogVisible);
        }

        const productTypesBaseQuery = this.supabase.from('product_types' as never).select('*');
        const productTypesOrderedQuery =
            typeof (productTypesBaseQuery as { order?: (...args: unknown[]) => unknown }).order ===
            'function'
                ? (productTypesBaseQuery as {
                      order: (column: string, opts: { ascending: boolean }) => unknown;
                  }).order('id', { ascending: true })
                : productTypesBaseQuery;
        const productTypesResult = (await productTypesOrderedQuery) as {
            data?: unknown;
            error?: unknown;
        };
        const data = productTypesResult.data;
        const error = productTypesResult.error;

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
        const source = await this.detectCatalogSource();
        if (source === 'none') {
            return [this.defaultRialMethod(plan.productTypeId ?? plan.id, fallbackCardNumber)];
        }
        if (!plan.productTypeId) {
            return [this.defaultRialMethod(plan.productTypeId ?? plan.id, fallbackCardNumber)];
        }

        const methodsBaseQuery = this.supabase
            .from('product_type_payment_methods' as never)
            .select('*')
            .eq('product_type_id', plan.productTypeId)
            .eq('is_active', true);
        const methodsOrderedQuery =
            typeof (methodsBaseQuery as { order?: (...args: unknown[]) => unknown }).order ===
            'function'
                ? (methodsBaseQuery as {
                      order: (column: string, opts: { ascending: boolean }) => unknown;
                  }).order('id', { ascending: true })
                : methodsBaseQuery;
        const methodsResult = (await methodsOrderedQuery) as { data?: unknown; error?: unknown };
        const data = methodsResult.data;
        const error = methodsResult.error;

        if (error || !Array.isArray(data) || data.length === 0) {
            // Keep purchase flow functional if rails table is empty/unavailable.
            // This still allows supplier-specific cards when table rows exist.
            return [this.defaultRialMethod(plan.productTypeId, fallbackCardNumber)];
        }

        const rows = data as unknown as DbRecord[];
        const mapped = rows
            .map((row) => this.mapPaymentMethodRow(row, plan.productTypeId!, fallbackCardNumber))
            .filter((m): m is PublicPaymentMethod => Boolean(m));
        if (mapped.length > 0) return mapped;
        return [this.defaultRialMethod(plan.productTypeId, fallbackCardNumber)];
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
        const visibilityFlag = asBoolean(row.is_catalog_visible);
        const activeFlag = asBoolean(row.is_active);
        const isCatalogVisible = (visibilityFlag ?? true) && (activeFlag ?? true);
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

    private mapLegacyPlanRow(row: DbRecord): PublicPlan | null {
        const id = asNumber(row.id);
        const slug = asString(row.slug);
        if (!id || !slug) return null;

        const title = asString(row.label_fa) ?? slug;
        const unitValue = asString(row.unit)?.toLowerCase();
        const unit: 'days' | 'gb' = unitValue === 'gb' ? 'gb' : 'days';
        const metricValue = asNumber(row.metric_value) ?? 0;
        const priceToman = asNumber(row.price_toman) ?? 0;
        const isCatalogVisible = asBoolean(row.is_active) ?? true;

        return {
            id,
            slug,
            title,
            unit,
            metricValue,
            priceToman,
            rating: null,
            guidelineText: null,
            isCatalogVisible,
            internalPlanKey: slug,
            productTypeId: id,
        };
    }

    private mapPaymentMethodRow(
        row: DbRecord,
        productTypeId: number,
        fallbackCardNumber: string
    ): PublicPaymentMethod | null {
        const isActive = asBoolean(row.is_active);
        if (isActive === false) return null;
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

    private defaultRialMethod(
        productTypeId: number,
        fallbackCardNumber: string
    ): PublicPaymentMethod {
        return {
            id: productTypeId * 1000 + 1,
            productTypeId,
            kind: 'rial_card',
            label: 'کارت به کارت',
            payToValue: fallbackCardNumber,
            instructions: null,
            metadata: {},
        };
    }
}
