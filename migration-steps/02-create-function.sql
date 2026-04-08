-- Step 2: Create a function to generate random transaction IDs
CREATE OR REPLACE FUNCTION generate_random_txn_id() 
RETURNS TEXT AS $$
BEGIN
    RETURN 'TXN-' || 
           substring(extract(epoch from now())::text, 7, 6) || 
           '-' || 
           substring(md5(random()::text), 1, 3);
END;
$$ LANGUAGE plpgsql; 