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

function parseJsonObject(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return null;
        }
    }
    return null;
}

function parseCardList(raw: string | null): string[] {
    if (!raw) return [];
    const normalized = raw.trim();
    if (!normalized) return [];

    const byNewline = normalized
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (byNewline.length > 1) return byNewline;

    const jsonLike = parseJsonObject(normalized);
    if (jsonLike) {
        const value = jsonLike.cardNumbers ?? jsonLike.cards ?? jsonLike.list;
        if (Array.isArray(value)) {
            return value
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
        }
    }

    return [normalized];
}

function computeStableRotationIndex(seed: string, size: number): number {
    if (size <= 1) return 0;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const positive = hash >>> 0;
    return positive % size;
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
        plan: PublicPlan
    ): Promise<PublicPaymentMethod[]> {
        const source = await this.detectCatalogSource();
        const productTypeId = plan.productTypeId ?? plan.id;
        if (source === 'none' || !productTypeId) return [];

        const methodsBaseQuery = this.supabase
            .from('product_type_payment_methods' as never)
            .select('*')
            .eq('product_type_id', productTypeId)
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

        if (!error && Array.isArray(data) && data.length > 0) {
            const rows = data as unknown as DbRecord[];
            const mapped = rows
                .map((row) => this.mapPaymentMethodRow(row, productTypeId))
                .filter((m): m is PublicPaymentMethod => Boolean(m));
            const rotated = this.rotateRialMethods(mapped, plan);
            if (rotated.length > 0) return rotated;
        }

        const fallback = await this.loadDbFallbackMethodsForPlan(plan, productTypeId);
        return this.rotateRialMethods(fallback, plan);
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
        productTypeId: number
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
            null;
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
                payee: asString(row.payee),
                supplierPaymentMethodId:
                    asNumber(row.supplier_payment_method_id) ??
                    asNumber(row.payment_method_id),
                supplierId: asNumber(row.supplier_id),
            },
        };
    }

    private async loadDbFallbackMethodsForPlan(
        plan: PublicPlan,
        productTypeId: number
    ): Promise<PublicPaymentMethod[]> {
        const source = await this.detectCatalogSource();
        if (source !== 'vpn_product_types') return [];

        const { data: ptRowRaw, error: ptErr } = await this.supabase
            .from('vpn_product_types' as never)
            .select('*')
            .eq('id', productTypeId)
            .maybeSingle();
        if (ptErr || !ptRowRaw) return [];

        const ptRow = ptRowRaw as unknown as DbRecord;
        const result: PublicPaymentMethod[] = [];

        const overrideCardsJson = ptRow.rial_card_numbers_override;
        let overrideCards: string[] = [];
        if (Array.isArray(overrideCardsJson)) {
            overrideCards = (overrideCardsJson as unknown[])
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
        } else if (typeof overrideCardsJson === 'string') {
            overrideCards = parseCardList(overrideCardsJson);
        }
        if (overrideCards.length > 0) {
            overrideCards.forEach((card, index) => {
                result.push({
                    id: productTypeId * 1000 + 100 + index,
                    productTypeId,
                    kind: 'rial_card',
                    label: `کارت به کارت`,
                    payToValue: card,
                    instructions: asString(ptRow.guideline_text) ?? null,
                    metadata: { source: 'product_type_override' },
                });
            });
            return result;
        }

        const supplierId = asNumber(ptRow.supplier_id);
        if (!supplierId) return result;

        const { data: supplierMethodsRaw, error: supplierMethodsErr } = await this.supabase
            .from('supplier_payment_methods' as never)
            .select('*')
            .eq('supplier_id', supplierId)
            .eq('is_active', true)
            .eq('kind', 'rial_card')
            .order('sort_order', { ascending: true })
            .order('id', { ascending: true });
        if (!supplierMethodsErr && Array.isArray(supplierMethodsRaw)) {
            const rows = supplierMethodsRaw as unknown as DbRecord[];
            const mapped = rows
                .map((row) => this.mapPaymentMethodRow(row, productTypeId))
                .filter((m): m is PublicPaymentMethod => Boolean(m))
                .map((m) => ({
                    ...m,
                    metadata: {
                        ...(m.metadata ?? {}),
                        source: 'supplier_payment_methods',
                    },
                }));
            if (mapped.length > 0) return mapped;
        }

        const { data: supplierRaw, error: supplierErr } = await this.supabase
            .from('suppliers' as never)
            .select('default_rial_card_numbers')
            .eq('id', supplierId)
            .maybeSingle();
        if (supplierErr || !supplierRaw) return result;

        const supplierRow = supplierRaw as unknown as DbRecord;
        const rawDefaultCards = supplierRow.default_rial_card_numbers;
        let defaultCards: string[] = [];
        if (Array.isArray(rawDefaultCards)) {
            defaultCards = (rawDefaultCards as unknown[])
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
        } else if (typeof rawDefaultCards === 'string') {
            defaultCards = parseCardList(rawDefaultCards);
        } else if (rawDefaultCards && typeof rawDefaultCards === 'object') {
            const obj = rawDefaultCards as Record<string, unknown>;
            if (Array.isArray(obj.cardNumbers)) {
                defaultCards = obj.cardNumbers
                    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                    .filter(Boolean);
            }
        }

        defaultCards.forEach((card, index) => {
            result.push({
                id: productTypeId * 1000 + 200 + index,
                productTypeId,
                kind: 'rial_card',
                label: `کارت به کارت`,
                payToValue: card,
                instructions: null,
                metadata: { source: 'supplier_default_cards' },
            });
        });

        return result;
    }

    private rotateRialMethods(methods: PublicPaymentMethod[], plan: PublicPlan): PublicPaymentMethod[] {
        if (!methods.length) return methods;
        const rial = methods.filter((m) => m.kind === 'rial_card');
        const nonRial = methods.filter((m) => m.kind !== 'rial_card');
        if (rial.length <= 1) return [...rial, ...nonRial];

        const byCard = new Map<string, PublicPaymentMethod>();
        for (const method of rial) {
            const key = (method.payToValue ?? '').trim();
            if (!key) continue;
            if (!byCard.has(key)) byCard.set(key, method);
        }
        const distinct = Array.from(byCard.values());
        if (!distinct.length) return nonRial;

        const seed = `${plan.productTypeId ?? plan.id}:${plan.internalPlanKey}`;
        const chosen = distinct[computeStableRotationIndex(seed, distinct.length)];
        return [chosen, ...nonRial];
    }
}
