import { UserStep } from './constants';

export interface User {
    id: number;
    telegram_id: number;
    first_name: string;
    username?: string;
    step: UserStep;
    selected_plan?: string;
    amount?: number;
    vpn_username?: string;
    vpn_password?: string;
    created_at: string;
    updated_at: string;
}

export interface VpnAccount {
    id: number;
    user_id: number;
    username: string;
    password: string;
    expiry_date: string;
    is_active: boolean;
    /** Plan slug */
    plan: string;
    inventory_id?: number | null;
    config_format?: string | null;
    created_at: string;
    updated_at: string;
}

/** Catalog row: duration (days) or traffic (GB). Slug matches payments.plan / inventory. */
export interface VpnProductType {
    id: number;
    slug: string;
    label_fa: string;
    unit: 'days' | 'gb';
    metric_value: number;
    price_toman: number | null;
    sort_order: number;
    is_active: boolean;
    supplier_id?: number | null;
    guideline_text?: string | null;
    connection_url_template?: string | null;
    delivery_config_text?: string | null;
    delivery_config_file_id?: string | null;
    delivery_config_format?: string | null;
    created_at: string;
}

export interface Payment {
    id: number;
    user_id: number;
    amount: number;
    plan: string;
    card_last_digits?: string;
    transaction_id: string;
    status: string;
    proof_file_id?: string | null;
    proof_type?: string | null;
    review_status?: string | null;
    created_at: string;
    updated_at: string;
}

export interface AppSetting {
    key: string;
    value: string;
    updated_at: string;
}

export interface AccountInventory {
    id: number;
    username: string;
    password: string;
    plan_key: string | null;
    product_type_id: number | null;
    stock_chat_id: number | null;
    stock_message_id: number | null;
    config_format: string;
    config_text: string | null;
    config_file_id: string | null;
    status: string;
    sold_user_id: number | null;
    sold_payment_id: number | null;
    sold_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ProductType {
    id: number;
    slug: string | null;
    code: string | null;
    plan_key: string | null;
    title: string | null;
    label_fa: string | null;
    unit: string | null;
    metric_value: number | null;
    days: number | null;
    price_toman: number | null;
    price: number | null;
    rating: number | null;
    guideline_text: string | null;
    is_catalog_visible: boolean | null;
}

export interface Database {
    public: {
        Tables: {
            vpn_users: {
                Row: User;
                Insert: Omit<User, 'id' | 'created_at' | 'updated_at'>;
                Update: Partial<Omit<User, 'id'>>;
            };
            vpn_accounts: {
                Row: VpnAccount;
                Insert: Omit<VpnAccount, 'id' | 'created_at' | 'updated_at'>;
                Update: Partial<Omit<VpnAccount, 'id'>>;
            };
            payments: {
                Row: Payment;
                Insert: Omit<Payment, 'id' | 'created_at' | 'updated_at'>;
                Update: Partial<Omit<Payment, 'id'>>;
            };
            app_settings: {
                Row: AppSetting;
                Insert: Omit<AppSetting, 'updated_at'> | AppSetting;
                Update: Partial<AppSetting>;
            };
            account_inventory: {
                Row: AccountInventory;
                Insert: Omit<AccountInventory, 'id' | 'created_at' | 'updated_at'>;
                Update: Partial<Omit<AccountInventory, 'id'>>;
            };
            product_types: {
                Row: ProductType;
                Insert: Partial<Omit<ProductType, 'id'>>;
                Update: Partial<Omit<ProductType, 'id'>>;
            };
        };
    };
}

// ---------- Domain models (application layer) ----------
export type ProductUnit = 'days' | 'gb';
export type ConfigFormat = 'openvpn' | 'v2ray';

export type PaymentLifecycleStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export type PaymentMethodKind = 'rial_card' | 'ton' | 'crypto' | 'other';
export type PaymentMethodPayee = 'platform' | 'supplier';

export interface PublicPlan {
    id: number;
    slug: string;
    title: string;
    unit: ProductUnit;
    metricValue: number;
    priceToman: number;
    rating?: number | null;
    guidelineText?: string | null;
    isCatalogVisible: boolean;
    /**
     * Internal key required by current fulfillment pipeline.
     * Never shown to end-users.
     */
    internalPlanKey: string;
    productTypeId?: number | null;
    /** Internal-only supplier binding for payment routing. */
    supplierId?: number | null;
    /** Optional per-product override card list (raw DB value normalized in service). */
    rialCardNumbersOverride?: string[] | null;
}

export interface PublicPaymentMethod {
    id: number;
    productTypeId: number;
    kind: PaymentMethodKind;
    label: string;
    instructions?: string | null;
    payToValue?: string | null;
    metadata?: Record<string, unknown>;
}

export interface CheckoutSession {
    telegramUserId: number;
    productTypeId: number;
    paymentMethodId: number;
    quotedAmountToman: number;
    createdAt: string;
    expiresAt: string;
}

export interface PaymentInstruction {
    paymentMethodId: number;
    kind: PaymentMethodKind;
    label: string;
    amountToman: number;
    payToValue?: string | null;
    instructionText: string;
    deepLink?: string | null;
    qrPayload?: string | null;
}

export interface PaymentSubmission {
    telegramUserId: number;
    productTypeId: number;
    paymentMethodId: number;
    amountToman: number;
    transactionId: string;
    cardLastDigits?: string | null;
    proofFileId?: string | null;
    proofType?: 'photo' | 'document' | null;
}

export interface CustomerOrderStatus {
    paymentId: number;
    status: PaymentLifecycleStatus;
    reviewStatus: ReviewStatus;
    createdAt: string;
    updatedAt: string;
}

export interface DeliveryPackage {
    vpnUsername: string;
    vpnPassword: string;
    configFormat: ConfigFormat;
    configText?: string | null;
    configFileId?: string | null;
    connectionUrl?: string | null;
    guidelineText?: string | null;
    providerPanelUrl?: string | null;
}
