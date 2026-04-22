import { UserStep, VpnPlanKey } from './constants';

export interface User {
    id: number;
    telegram_id: number;
    first_name: string;
    username?: string;
    step: UserStep;
    selected_plan?: VpnPlanKey;
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
    created_at: string;
}

export interface Payment {
    id: number;
    user_id: number;
    amount: number;
    /** Plan slug: legacy `1month` / `3months` or custom product type slug */
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
            vpn_product_types: {
                Row: VpnProductType;
                Insert: Omit<VpnProductType, 'id' | 'created_at'>;
                Update: Partial<Omit<VpnProductType, 'id' | 'created_at'>>;
            };
        };
    };
}
