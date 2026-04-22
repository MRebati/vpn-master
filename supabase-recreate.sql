-- Recreate VPN Master database schema (Supabase/Postgres)
-- Run in Supabase SQL Editor.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.payments') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS update_payments_timestamp ON public.payments;
    END IF;
    IF to_regclass('public.vpn_accounts') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS update_vpn_accounts_timestamp ON public.vpn_accounts;
    END IF;
    IF to_regclass('public.vpn_users') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS update_vpn_users_timestamp ON public.vpn_users;
    END IF;
    IF to_regclass('public.account_inventory') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS update_account_inventory_timestamp ON public.account_inventory;
    END IF;
    IF to_regclass('public.app_settings') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS update_app_settings_timestamp ON public.app_settings;
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.update_timestamp();

DROP TABLE IF EXISTS public.vpn_accounts CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.account_inventory CASCADE;
DROP TABLE IF EXISTS public.vpn_product_types CASCADE;
DROP TABLE IF EXISTS public.vpn_users CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;

-- Key/value (card number, support channel, etc.) — managed via admin bot
CREATE TABLE public.app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.vpn_users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    username TEXT,
    step TEXT NOT NULL DEFAULT 'idle',
    selected_plan TEXT,
    amount INTEGER,
    vpn_username TEXT,
    vpn_password TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.payments (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.vpn_users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    plan TEXT NOT NULL,
    card_last_digits TEXT NOT NULL DEFAULT 'proof',
    status TEXT NOT NULL DEFAULT 'PENDING',
    transaction_id TEXT NOT NULL UNIQUE,
    proof_file_id TEXT,
    proof_type TEXT,
    review_status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.vpn_product_types (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label_fa TEXT NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('days', 'gb')),
    metric_value NUMERIC NOT NULL CHECK (metric_value > 0),
    price_toman INTEGER,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.vpn_product_types (slug, label_fa, unit, metric_value, price_toman, sort_order)
VALUES
    ('1month', 'یک‌ماهه', 'days', 30, 150000, 1),
    ('3months', 'سه‌ماهه', 'days', 90, 400000, 2);

CREATE TABLE public.account_inventory (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    plan_key TEXT,
    product_type_id BIGINT REFERENCES public.vpn_product_types(id) ON DELETE SET NULL,
    stock_chat_id BIGINT,
    stock_message_id INT,
    config_format TEXT NOT NULL DEFAULT 'openvpn',
    config_text TEXT,
    config_file_id TEXT,
    status TEXT NOT NULL DEFAULT 'available',
    sold_user_id BIGINT REFERENCES public.vpn_users(id) ON DELETE SET NULL,
    sold_payment_id BIGINT REFERENCES public.payments(id) ON DELETE SET NULL,
    sold_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.vpn_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.vpn_users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT '1month',
    expiry_date TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    inventory_id BIGINT REFERENCES public.account_inventory(id) ON DELETE SET NULL,
    config_format TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_app_settings_timestamp
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE TRIGGER update_vpn_users_timestamp
BEFORE UPDATE ON public.vpn_users
FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE TRIGGER update_payments_timestamp
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE TRIGGER update_account_inventory_timestamp
BEFORE UPDATE ON public.account_inventory
FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE TRIGGER update_vpn_accounts_timestamp
BEFORE UPDATE ON public.vpn_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE INDEX vpn_users_telegram_id_idx ON public.vpn_users (telegram_id);
CREATE INDEX vpn_accounts_user_id_idx ON public.vpn_accounts (user_id);
CREATE INDEX vpn_accounts_inventory_id_idx ON public.vpn_accounts (inventory_id);
CREATE INDEX payments_user_id_idx ON public.payments (user_id);
CREATE INDEX payments_transaction_id_idx ON public.payments (transaction_id);
CREATE INDEX payments_review_status_idx ON public.payments (review_status);
CREATE INDEX account_inventory_status_plan_idx ON public.account_inventory (status, plan_key);
CREATE INDEX account_inventory_product_type_status_idx ON public.account_inventory (product_type_id, status);

COMMIT;
