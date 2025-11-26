/**
 * Database Module - Supabase Integration with Encryption
 *
 * Handles secure storage and retrieval of wallet credentials
 * Encrypts private keys and mnemonics using AES-256-GCM
 *
 * Environment Variables Required:
 * - NEXT_PUBLIC_SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Supabase service role key (for backend)
 * - ENCRYPTION_KEY: 32-byte hex key for AES-256 encryption
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// IMPORTANT: Backend should use SERVICE_ROLE_KEY, not ANON_KEY
// Service role key bypasses RLS policies for backend operations
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase credentials");
  console.log("Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY");
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.warn("⚠️  WARNING: Using ANON_KEY instead of SERVICE_ROLE_KEY");
  console.warn(
    "⚠️  For production, set SUPABASE_SERVICE_KEY in your .env file"
  );
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
});

// Export supabase client for direct database access
export { supabase };

// Encryption configuration
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, "hex")
  : null;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
  console.error(
    "❌ ENCRYPTION_KEY must be a 32-byte hex string (64 characters)"
  );
  console.log(
    "💡 Generate one with: node -e \"console.log(crypto.randomBytes(32).toString('hex'))\""
  );
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
}

/**
 * Initialize database schema
 * With Supabase, schema is managed via migrations
 */
export async function initializeDatabase() {
  try {
    console.log("📦 Checking database connection...");

    // Test connection by querying the wallets table
    const { error } = await supabase.from("wallets").select("id").limit(1);

    if (error) {
      console.error("❌ Database connection error:", error.message);
      throw error;
    }

    console.log("✅ Database connection successful");
  } catch (error) {
    console.error("❌ Error initializing database:", error);
    throw error;
  }
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns { encrypted, iv, authTag }
 */
function encrypt(text) {
  if (!ENCRYPTION_KEY) {
    throw new Error("Encryption key not configured");
  }

  // Generate a random initialization vector
  const iv = crypto.randomBytes(16);

  // Create cipher
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    ENCRYPTION_KEY,
    iv
  );

  // Encrypt the text
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypt a string using AES-256-GCM
 * Takes { encrypted, iv, authTag }
 * Returns decrypted string
 */
function decrypt(encrypted, iv, authTag) {
  if (!ENCRYPTION_KEY) {
    throw new Error("Encryption key not configured");
  }

  // Create decipher
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(iv, "hex")
  );

  // Set authentication tag
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  // Decrypt the text
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Store wallet credentials in database (encrypted)
 *
 * @param {Object} params
 * @param {BigInt} params.requestId - Unique request ID from VendingMachine
 * @param {string} params.buyer - Buyer's wallet address
 * @param {string} params.walletAddress - Generated wallet address
 * @param {string} params.privateKey - Private key (will be encrypted)
 * @param {string} params.mnemonic - Seed phrase (will be encrypted)
 * @param {number} params.tier - Tier (1-4)
 * @param {BigInt} params.estimatedValue - Estimated value in USDC (6 decimals)
 * @param {number} params.actualValue - Actual value in USD (calculated)
 * @param {Array} params.tokens - Array of { address, amount, symbol }
 */
export async function storeWallet({
  requestId,
  buyer,
  walletAddress,
  privateKey,
  mnemonic,
  tier,
  estimatedValue,
  actualValue,
  tokens,
}) {
  try {
    console.log(`💾 Storing wallet for request ${requestId}...`);

    // Encrypt sensitive data
    const encryptedPrivateKey = encrypt(privateKey);
    const encryptedMnemonic = encrypt(mnemonic);

    // Insert into database
    const { data, error } = await supabase
      .from("wallets")
      .insert({
        request_id: requestId.toString(),
        buyer: buyer.toLowerCase(),
        wallet_address: walletAddress.toLowerCase(),
        private_key_encrypted: encryptedPrivateKey.encrypted,
        private_key_iv: encryptedPrivateKey.iv,
        private_key_tag: encryptedPrivateKey.authTag,
        mnemonic_encrypted: encryptedMnemonic.encrypted,
        mnemonic_iv: encryptedMnemonic.iv,
        mnemonic_tag: encryptedMnemonic.authTag,
        tier,
        estimated_value: estimatedValue.toString(),
        actual_value: actualValue,
        tokens,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        console.error(`❌ Wallet for request ${requestId} already exists`);
        throw new Error("Wallet already exists for this request ID");
      }
      throw error;
    }

    console.log(`✅ Wallet stored with ID ${data.id}`);
    return data.id;
  } catch (error) {
    console.error("❌ Error storing wallet:", error);
    throw error;
  }
}

/**
 * Retrieve wallet credentials by request ID
 * Decrypts and returns wallet data
 *
 * @param {BigInt} requestId - Request ID from VendingMachine
 * @param {string} buyerAddress - Buyer's address (for verification)
 * @returns {Object} Wallet data with decrypted credentials
 */
export async function getWallet(requestId, buyerAddress) {
  try {
    console.log(`🔍 Retrieving wallet for request ${requestId}...`);

    // Query database
    const { data, error } = await supabase
      .from("wallets")
      .select("*")
      .eq("request_id", requestId.toString())
      .eq("buyer", buyerAddress.toLowerCase())
      .single();

    if (error || !data) {
      console.log("❌ Wallet not found");
      return null;
    }

    // Decrypt sensitive data
    const privateKey = decrypt(
      data.private_key_encrypted,
      data.private_key_iv,
      data.private_key_tag
    );

    const mnemonic = decrypt(
      data.mnemonic_encrypted,
      data.mnemonic_iv,
      data.mnemonic_tag
    );

    // Update retrieval stats
    await supabase
      .from("wallets")
      .update({
        retrieved: true,
        retrieved_at: data.retrieved_at || new Date().toISOString(),
        retrieval_count: (data.retrieval_count || 0) + 1,
      })
      .eq("id", data.id);

    console.log("✅ Wallet retrieved successfully");

    return {
      requestId: BigInt(data.request_id),
      buyer: data.buyer,
      walletAddress: data.wallet_address,
      privateKey,
      mnemonic,
      tier: data.tier,
      estimatedValue: BigInt(data.estimated_value),
      actualValue: parseFloat(data.actual_value),
      tokens: data.tokens,
      createdAt: data.created_at,
      retrieved: data.retrieved,
      retrievedAt: data.retrieved_at,
      retrievalCount: data.retrieval_count,
    };
  } catch (error) {
    console.error("❌ Error retrieving wallet:", error);
    throw error;
  }
}

/**
 * Get all wallets for a buyer address
 * Does not return decrypted credentials (for listing only)
 *
 * @param {string} buyerAddress - Buyer's wallet address
 * @returns {Array} Array of wallet records (without decrypted keys)
 */
export async function getWalletsByBuyer(buyerAddress) {
  try {
    const { data, error } = await supabase
      .from("wallets")
      .select(
        `request_id,
        buyer,
        wallet_address,
        tier,
        estimated_value,
        actual_value,
        tokens,
        created_at,
        retrieved,
        retrieved_at,
        retrieval_count`
      )
      .eq("buyer", buyerAddress.toLowerCase())
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (data || []).map((row) => ({
      requestId: BigInt(row.request_id),
      buyer: row.buyer,
      walletAddress: row.wallet_address,
      tier: row.tier,
      estimatedValue: BigInt(row.estimated_value),
      actualValue: parseFloat(row.actual_value),
      tokens: row.tokens,
      createdAt: row.created_at,
      retrieved: row.retrieved,
      retrievedAt: row.retrieved_at,
      retrievalCount: row.retrieval_count,
    }));
  } catch (error) {
    console.error("❌ Error fetching wallets by buyer:", error);
    throw error;
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  try {
    const { data, error } = await supabase
      .from("wallets")
      .select("tier, retrieved, actual_value");

    if (error) throw error;

    const stats = {
      total_wallets: data.length,
      retrieved_wallets: data.filter((w) => w.retrieved).length,
      tier1_count: data.filter((w) => w.tier === 1).length,
      tier2_count: data.filter((w) => w.tier === 2).length,
      tier3_count: data.filter((w) => w.tier === 3).length,
      tier4_count: data.filter((w) => w.tier === 4).length,
      total_value_distributed: data.reduce(
        (sum, w) => sum + parseFloat(w.actual_value || 0),
        0
      ),
    };

    return stats;
  } catch (error) {
    console.error("❌ Error fetching database stats:", error);
    throw error;
  }
}

/**
 * Test database connection
 */
export async function testConnection() {
  try {
    const { error } = await supabase.from("wallets").select("id").limit(1);
    if (error) throw error;
    console.log("✅ Database connection successful");
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    return false;
  }
}

/**
 * Delete wallet credentials older than 5 minutes
 * Security feature: Private keys should only be stored temporarily
 */
export async function cleanupOldWallets() {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("wallets")
      .delete()
      .lt("created_at", fiveMinutesAgo)
      .select("request_id, buyer");

    if (error) throw error;

    if (data && data.length > 0) {
      console.log(
        `🗑️  Cleaned up ${data.length} wallet(s) older than 5 minutes`
      );
      data.forEach((row) => {
        console.log(`   - Request ID: ${row.request_id}, Buyer: ${row.buyer}`);
      });
    }

    return data ? data.length : 0;
  } catch (error) {
    console.error("❌ Error cleaning up old wallets:", error);
    throw error;
  }
}

/**
 * Start automatic cleanup of old wallets
 * Runs every minute to delete wallets older than 5 minutes
 */
let cleanupInterval = null;

export function startAutoCleanup() {
  if (cleanupInterval) {
    console.log("⚠️  Auto-cleanup already running");
    return;
  }

  console.log(
    "🔄 Starting auto-cleanup of wallet credentials (every 1 minute)"
  );

  // Run cleanup immediately on start
  cleanupOldWallets().catch((err) =>
    console.error("❌ Initial cleanup failed:", err)
  );

  // Then run every minute
  cleanupInterval = setInterval(() => {
    cleanupOldWallets().catch((err) =>
      console.error("❌ Scheduled cleanup failed:", err)
    );
  }, 60 * 1000); // Every 1 minute
}

/**
 * Stop automatic cleanup
 */
export function stopAutoCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("⏹️  Auto-cleanup stopped");
  }
}

/**
 * Close database (for graceful shutdown)
 */
export async function closeDatabase() {
  stopAutoCleanup();
  console.log("👋 Database cleanup stopped");
}

// Handle process termination
process.on("SIGINT", async () => {
  await closeDatabase();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeDatabase();
  process.exit(0);
});
