-- Step 5: Verify the update (check count of NULL values, should be 0)
SELECT COUNT(*) FROM public.payments WHERE transaction_id IS NULL; 