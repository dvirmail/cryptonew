-- 002_rls_policies.sql

-- Enable Row Level Security for users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Admins can view all users
CREATE POLICY "Admins can view all users" 
ON users
FOR SELECT
USING (
    role = 'admin' AND auth.uid() IS NOT NULL
);

-- Admins can insert users
CREATE POLICY "Admins can insert users" 
ON users
FOR INSERT
WITH CHECK (
    role = 'admin' AND auth.uid() IS NOT NULL
);

-- Admins can update users
CREATE POLICY "Admins can update users"
ON users
FOR UPDATE
USING (
    role = 'admin' AND auth.uid() IS NOT NULL
)
WITH CHECK (
    role = 'admin'
);

-- Admins can delete users
CREATE POLICY "Admins can delete users"
ON users
FOR DELETE
USING (
    role = 'admin' AND auth.uid() IS NOT NULL
);

