-- Create users table
CREATE TABLE IF NOT EXISTS public.vpn_users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    username TEXT,
    step TEXT NOT NULL DEFAULT 'idle',
    selected_plan TEXT,
    amount INTEGER,
    vpn_username TEXT,
    vpn_password TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create vpn_accounts table
CREATE TABLE IF NOT EXISTS public.vpn_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.vpn_users(id),
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create payments table
CREATE TABLE IF NOT EXISTS public.payments (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.vpn_users(id),
    amount INTEGER NOT NULL,
    plan TEXT NOT NULL,
    card_last_digits TEXT DEFAULT 'pending',
    status TEXT NOT NULL DEFAULT 'pending',
    transaction_id TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create a function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to automatically update the updated_at field
CREATE TRIGGER update_vpn_users_timestamp
BEFORE UPDATE ON public.vpn_users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_vpn_accounts_timestamp
BEFORE UPDATE ON public.vpn_accounts
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_payments_timestamp
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION update_timestamp(); 