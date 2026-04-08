-- Step 4: Populate existing rows with transaction IDs
UPDATE public.payments 
SET transaction_id = generate_random_txn_id()
WHERE transaction_id IS NULL; 