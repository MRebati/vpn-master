-- Run after existing schema. Adds flexible VPN product types (days or GB) and stock message tracking.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vpn_product_types (
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
    ('3months', 'سه‌ماهه', 'days', 90, 400000, 2)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.account_inventory
    ADD COLUMN IF NOT EXISTS product_type_id BIGINT REFERENCES public.vpn_product_types(id) ON DELETE SET NULL;

ALTER TABLE public.account_inventory
    ADD COLUMN IF NOT EXISTS stock_chat_id BIGINT;

ALTER TABLE public.account_inventory
    ADD COLUMN IF NOT EXISTS stock_message_id INT;

CREATE INDEX IF NOT EXISTS account_inventory_product_type_status_idx
    ON public.account_inventory (product_type_id, status);

COMMIT;
