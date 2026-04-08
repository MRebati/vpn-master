-- Add the transaction_id column
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS transaction_id TEXT;

-- List IDs needing transaction IDs
SELECT id FROM public.payments WHERE transaction_id IS NULL;

-- Update with simple concatenation (no functions)
UPDATE public.payments 
SET transaction_id = 'TXN-' || id::TEXT || '-' || EXTRACT(EPOCH FROM NOW())::TEXT 
WHERE transaction_id IS NULL;

-- Verify updates
SELECT id, transaction_id FROM public.payments;

-- Set NOT NULL constraint
ALTER TABLE public.payments ALTER COLUMN transaction_id SET NOT NULL;

-- Add unique constraint
ALTER TABLE public.payments ADD CONSTRAINT payments_txn_id_unique UNIQUE (transaction_id); 