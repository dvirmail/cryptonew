export const SETUP_INSTRUCTIONS = \`
# CryptoSentinel Local Migration - Step by Step Instructions

## What You Need To Do Right Now:

### Step 1: Download Your Code from Base44
1. Go to your Base44 workspace
2. Copy ALL your code files to your Mac:
   - All files from pages/ folder
   - All files from components/ folder  
   - Your Layout.js file
   - All files from functions/ folder
   - All files from entities/ folder

### Step 2: Set Up Your Mac Environment

Open Terminal and run these commands one by one:

\`\`\`bash
# Install Homebrew (if you don't have it)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required software
brew install node deno postgresql@14 git

# Start PostgreSQL
brew services start postgresql@14

# Create your project directory
mkdir ~/crypto-sentinel-local
cd ~/crypto-sentinel-local
mkdir frontend backend database
\`\`\`

### Step 3: Set Up Database

\`\`\`bash
# Access PostgreSQL
psql postgres

# In the PostgreSQL shell, run these commands:
CREATE DATABASE cryptosentinel;
CREATE USER cryptouser WITH PASSWORD 'your_secure_password_123';
GRANT ALL PRIVILEGES ON DATABASE cryptosentinel TO cryptouser;
\\q
\`\`\`

### Step 4: Create Database Schema

1. Copy the SQL schema from the DatabaseSchema component I created
2. Save it as ~/crypto-sentinel-local/database/schema.sql
3. Run it:

\`\`\`bash
psql -U cryptouser -d cryptosentinel -f ~/crypto-sentinel-local/database/schema.sql
\`\`\`

### Step 5: Set Up Backend Server

1. Copy the server code from LocalServerTemplate component I created
2. Save it as ~/crypto-sentinel-local/backend/server.ts
3. Test it:

\`\`\`bash
cd ~/crypto-sentinel-local/backend
deno run --allow-all server.ts
\`\`\`

### Step 6: Set Up Frontend

\`\`\`bash
cd ~/crypto-sentinel-local/frontend
npx create-react-app . --template typescript
npm install axios react-router-dom lucide-react recharts date-fns lodash
\`\`\`

Then copy all your pages/, components/, and Layout.js files into the frontend/src/ directory.

### Step 7: Update Your Frontend Code

You'll need to change how your frontend calls APIs. Instead of:
\`\`\`javascript
import { SomeFunction } from "@/api/functions/someFunction";
\`\`\`

Change to:
\`\`\`javascript
import axios from 'axios';
const response = await axios.post('http://localhost:3001/api/functions/someFunction', data);
\`\`\`

### Step 8: Migrate Your Functions

For each file in your functions/ folder, you need to:
1. Copy the logic from the function
2. Add it as a route in your backend/server.ts
3. Make sure it connects to your local PostgreSQL database instead of Base44's database

### Step 9: Test Everything

1. Start your backend: \`cd backend && deno run --allow-all server.ts\`
2. Start your frontend: \`cd frontend && npm start\`
3. Open http://localhost:3000

## Need Help?

If you get stuck on any step, let me know which specific step you're on and what error you're seeing. I can help you debug and fix any issues.

The key is to go step by step - don't try to do everything at once!
\`;

export default SETUP_INSTRUCTIONS;