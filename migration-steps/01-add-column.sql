-- Step 1: Add transaction_id column if it doesn't exist
ALTER TABLE public.payments 
ADD COLUMN IF NOT EXISTS transaction_id TEXT; 