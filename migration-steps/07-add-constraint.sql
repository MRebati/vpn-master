-- Step 7: Add unique constraint
ALTER TABLE public.payments 
ADD CONSTRAINT payments_transaction_id_unique UNIQUE (transaction_id); 