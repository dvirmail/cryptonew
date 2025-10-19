export const LOCAL_SERVER_CODE = `
// server.ts - Your local Deno server
import { Application, Router, Context } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";

// Database connection pool
const pool = new Pool({
  user: "cryptouser",
  password: "your_secure_password_123", // Change this to your password
  database: "cryptosentinel",
  hostname: "localhost",
  port: 5432,
}, 3);

const app = new Application();
const router = new Router();

// Enable CORS for your React frontend
app.use(oakCors({
  origin: "http://localhost:3000",
  credentials: true,
}));

// Parse JSON bodies
app.use(async (ctx, next) => {
  if (ctx.request.hasBody) {
    try {
      ctx.request.body = await ctx.request.body().value;
    } catch (error) {
      console.error("Error parsing request body:", error);
    }
  }
  await next();
});

// Health check endpoint
router.get("/api/health", (ctx: Context) => {
  ctx.response.body = { 
    status: "OK", 
    timestamp: new Date().toISOString(),
    database: "connected"
  };
});

// Generic entity operations (replaces Base44 entity system)
router.get("/api/entities/:entityName", async (ctx: Context) => {
  const entityName = ctx.params.entityName?.toLowerCase();
  const userId = ctx.request.headers.get("user-id") || "admin@example.com";
  
  try {
    const client = await pool.connect();
    let query = '';
    let tableName = '';
    
    // Map entity names to table names
    switch(entityName) {
      case 'trade':
        tableName = 'trades';
        break;
      case 'tradingsignal':
        tableName = 'trading_signals';
        break;
      case 'backtestcombination':
        tableName = 'backtest_combinations';
        break;
      case 'virtualwalletstate':
        tableName = 'virtual_wallet_state';
        break;
      case 'livewalletstate':
        tableName = 'live_wallet_state';
        break;
      case 'scansettings':
        tableName = 'scan_settings';
        break;
      case 'optedoutcombination':
        tableName = 'opted_out_combinations';
        break;
      default:
        tableName = entityName + 's';
    }
    
    query = \`SELECT * FROM \${tableName} WHERE created_by = $1 ORDER BY created_date DESC\`;
    const result = await client.queryObject(query, [userId]);
    
    client.release();
    ctx.response.body = result.rows;
  } catch (error) {
    console.error(\`Error fetching \${entityName}:\`, error);
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Create entity record
router.post("/api/entities/:entityName", async (ctx: Context) => {
  const entityName = ctx.params.entityName?.toLowerCase();
  const userId = ctx.request.headers.get("user-id") || "admin@example.com";
  const data = await ctx.request.body().value;
  
  try {
    const client = await pool.connect();
    
    // Add created_by and timestamps
    data.created_by = userId;
    data.created_date = new Date();
    data.updated_date = new Date();
    
    // Dynamic insert based on entity
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => \`$\${i + 1}\`).join(', ');
    
    let tableName = '';
    switch(entityName) {
      case 'trade':
        tableName = 'trades';
        break;
      case 'tradingsignal':
        tableName = 'trading_signals';
        break;
      case 'backtestcombination':
        tableName = 'backtest_combinations';
        break;
      default:
        tableName = entityName + 's';
    }
    
    const query = \`
      INSERT INTO \${tableName} (\${columns.join(', ')}) 
      VALUES (\${placeholders}) 
      RETURNING *
    \`;
    
    const result = await client.queryObject(query, values);
    client.release();
    
    ctx.response.body = result.rows[0];
  } catch (error) {
    console.error(\`Error creating \${entityName}:\`, error);
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Update entity record
router.put("/api/entities/:entityName/:id", async (ctx: Context) => {
  const entityName = ctx.params.entityName?.toLowerCase();
  const id = ctx.params.id;
  const data = await ctx.request.body().value;
  
  try {
    const client = await pool.connect();
    
    data.updated_date = new Date();
    
    const columns = Object.keys(data);
    const values = Object.values(data);
    const setClause = columns.map((col, i) => \`\${col} = $\${i + 1}\`).join(', ');
    
    let tableName = '';
    switch(entityName) {
      case 'trade':
        tableName = 'trades';
        break;
      case 'tradingsignal':
        tableName = 'trading_signals';
        break;
      case 'backtestcombination':
        tableName = 'backtest_combinations';
        break;
      default:
        tableName = entityName + 's';
    }
    
    const query = \`
      UPDATE \${tableName} 
      SET \${setClause} 
      WHERE id = $\${values.length + 1} 
      RETURNING *
    \`;
    
    const result = await client.queryObject(query, [...values, id]);
    client.release();
    
    ctx.response.body = result.rows[0];
  } catch (error) {
    console.error(\`Error updating \${entityName}:\`, error);
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Your migrated functions go here
router.post("/api/functions/getBinancePrices", async (ctx: Context) => {
  // Copy your existing getBinancePrices function logic here
  try {
    const data = await ctx.request.body().value;
    // Your existing Binance API logic
    ctx.response.body = { success: true, data: "Implement your Binance logic here" };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

router.post("/api/functions/getKlineData", async (ctx: Context) => {
  // Copy your existing getKlineData function logic here
  try {
    const data = await ctx.request.body().value;
    // Your existing kline data logic
    ctx.response.body = { success: true, data: "Implement your kline logic here" };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Add all your other function endpoints here...

app.use(router.routes());
app.use(router.allowedMethods());

console.log("🚀 CryptoSentinel Local Server starting...");
console.log("   Database: PostgreSQL on localhost:5432");
console.log("   API Server: http://localhost:3001");
console.log("   Frontend should run on: http://localhost:3000");

await app.listen({ port: 3001 });
`;

export default LOCAL_SERVER_CODE;