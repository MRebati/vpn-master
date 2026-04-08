-- Alternative migration script without DO blocks

-- 1. Add transaction_id column if it doesn't exist
ALTER TABLE public.payments 
ADD COLUMN IF NOT EXISTS transaction_id TEXT;

-- 2. Create a temporary function to generate transaction IDs
CREATE OR REPLACE FUNCTION generate_transaction_id() 
RETURNS TEXT AS $$
BEGIN
    -- Return formatted transaction ID
    RETURN 'TXN-' || 
           substring(extract(epoch from now())::text, 7, 6) || 
           '-' || 
           substring(md5(random()::text), 1, 3);
END;
$$ LANGUAGE plpgsql;

-- 3. Update existing rows with generated transaction IDs
UPDATE public.payments 
SET transaction_id = generate_transaction_id()
WHERE transaction_id IS NULL;

-- 4. Make the column NOT NULL (comment this out if it fails due to existing NULL values)
ALTER TABLE public.payments 
ALTER COLUMN transaction_id SET NOT NULL;

-- 5. Add a unique constraint (comment this out if you have duplicate transaction IDs)
ALTER TABLE public.payments 
ADD CONSTRAINT IF NOT EXISTS payments_transaction_id_unique UNIQUE (transaction_id);

-- 6. Drop the temporary function
DROP FUNCTION IF EXISTS generate_transaction_id(); 