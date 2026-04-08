-- Step 6: Make column NOT NULL after confirming all rows have values
ALTER TABLE public.payments 
ALTER COLUMN transaction_id SET NOT NULL; 