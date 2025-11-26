import pg from "pg";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const { Client } = pg;

async function testConnection() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync("./prod-ca-2021.crt").toString(),
    },
  });

  try {
    console.log("🔄 Connecting to Supabase...");
    await client.connect();
    console.log("✅ Connected to Supabase successfully!");

    // Test query
    const result = await client.query("SELECT NOW()");
    console.log("✅ Query test passed:", result.rows[0]);

    // Check if wallets table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'wallets'
      );
    `);

    if (tableCheck.rows[0].exists) {
      console.log("✅ Wallets table exists!");

      // Get table structure
      const columns = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'wallets'
        ORDER BY ordinal_position;
      `);

      console.log("\n📋 Table structure:");
      columns.rows.forEach((col) => {
        console.log(`  - ${col.column_name}: ${col.data_type}`);
      });
    } else {
      console.log("❌ Wallets table does not exist!");
    }
  } catch (error) {
    console.error("❌ Connection failed:", error.message);
  } finally {
    await client.end();
  }
}

testConnection();
