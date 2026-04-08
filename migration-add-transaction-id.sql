-- Add transaction_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'payments' 
        AND column_name = 'transaction_id'
    ) THEN
        -- Add the column
        ALTER TABLE public.payments ADD COLUMN transaction_id TEXT;
        
        -- Create a temporary function to generate transaction IDs
        CREATE OR REPLACE FUNCTION generate_transaction_id() 
        RETURNS TEXT AS $$
        BEGIN
            -- Return formatted transaction ID (PostgreSQL version)
            -- Format: TXN-[timestamp]-[random]
            RETURN 'TXN-' || 
                   substring(extract(epoch from now())::text, 7, 6) || 
                   '-' || 
                   substring(md5(random()::text), 1, 3);
        END;
        $$ LANGUAGE plpgsql;
        
        -- Update existing rows with generated transaction IDs
        UPDATE public.payments 
        SET transaction_id = generate_transaction_id()
        WHERE transaction_id IS NULL;
        
        -- Make the column NOT NULL after populating it
        ALTER TABLE public.payments ALTER COLUMN transaction_id SET NOT NULL;
        
        -- Add a unique constraint
        ALTER TABLE public.payments ADD CONSTRAINT payments_transaction_id_unique UNIQUE (transaction_id);
        
        -- Drop the temporary function
        DROP FUNCTION generate_transaction_id();
    END IF;
END $$; 