-- Simple migration without functions
-- Run these statements one by one

-- 1. Add the transaction_id column
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS transaction_id TEXT;

-- 2. Generate and update transaction IDs for existing records
-- Update each row individually with hardcoded values
-- You may need to modify this approach based on how many payments you have

-- List all payment IDs that need transaction IDs
SELECT id FROM public.payments WHERE transaction_id IS NULL;

-- Then update each one with a unique transaction ID
-- Example (replace ID_VALUE with actual payment ID):
-- UPDATE public.payments SET transaction_id = 'TXN-123456-abc' WHERE id = ID_VALUE;

-- Or this one-time statement for all NULL transaction_ids
-- (You may need to run this multiple times if there are conflicts)
UPDATE public.payments 
SET transaction_id = 'TXN-' || 
                     floor(random() * 900000 + 100000)::text || 
                     '-' || 
                     substring(md5(random()::text || id::text), 1, 3)
WHERE transaction_id IS NULL;

-- 3. Verify all rows have transaction IDs
SELECT COUNT(*) FROM public.payments WHERE transaction_id IS NULL;

-- 4. Make the column NOT NULL
ALTER TABLE public.payments ALTER COLUMN transaction_id SET NOT NULL;

-- 5. Add a unique constraint
ALTER TABLE public.payments ADD CONSTRAINT payments_transaction_id_unique UNIQUE (transaction_id); 