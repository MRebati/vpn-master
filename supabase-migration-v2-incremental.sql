-- Incremental migration: add inventory + settings + payment proof columns
-- Use only if you already have the old three-table schema and cannot run supabase-recreate.sql.
-- Prefer a full recreate in dev; in production, back up first.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_app_settings_timestamp ON public.app_settings;
CREATE TRIGGER update_app_settings_timestamp
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE TABLE IF NOT EXISTS public.account_inventory (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    plan_key TEXT,
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

DROP TRIGGER IF EXISTS update_account_inventory_timestamp ON public.account_inventory;
CREATE TRIGGER update_account_inventory_timestamp
BEFORE UPDATE ON public.account_inventory
FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS proof_file_id TEXT,
    ADD COLUMN IF NOT EXISTS proof_type TEXT,
    ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.vpn_accounts
    ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT '1month',
    ADD COLUMN IF NOT EXISTS inventory_id BIGINT REFERENCES public.account_inventory(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS config_format TEXT;

CREATE INDEX IF NOT EXISTS account_inventory_status_plan_idx ON public.account_inventory (status, plan_key);
CREATE INDEX IF NOT EXISTS vpn_accounts_inventory_id_idx ON public.vpn_accounts (inventory_id);
CREATE INDEX IF NOT EXISTS payments_review_status_idx ON public.payments (review_status);

COMMIT;
