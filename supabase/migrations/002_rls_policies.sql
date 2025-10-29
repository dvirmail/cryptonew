-- 002_rls_policies.sql

-- Enable Row Level Security for users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to manage users (simplified for now)
CREATE POLICY "Allow all authenticated users to manage users" 
ON users
FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

