/**
 * API Server - Express REST API for Wallet Retrieval
 *
 * Provides secure wallet credential retrieval with signature verification
 *
 * Endpoints:
 * - GET /api/wallet/:requestId - Retrieve wallet credentials (requires signature)
 * - GET /api/wallets/:address - List wallets for a buyer address
 * - GET /api/stats - Get platform statistics
 * - GET /health - Health check
 */

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { verifyMessage } from "viem";
import * as dotenv from "dotenv";
import {
  getWallet,
  getWalletsByBuyer,
  getDatabaseStats,
  supabase,
} from "./database.js";

dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: [FRONTEND_URL, "http://localhost:3000"],
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

const walletLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit to 10 wallet retrievals per minute per IP
  message: "Too many wallet retrieval requests, please try again later.",
});

app.use("/api/", limiter);

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "Vendyz Backend API",
  });
});

/**
 * Get platform statistics
 */
app.get("/api/stats", async (req, res) => {
  try {
    const stats = await getDatabaseStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch statistics",
    });
  }
});

/**
 * List wallets for a buyer address
 * No authentication required (doesn't return credentials)
 *
 * GET /api/wallets/:address
 */
app.get("/api/wallets/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: "Invalid Ethereum address format",
      });
    }

    const wallets = await getWalletsByBuyer(address);

    res.json({
      success: true,
      data: {
        buyer: address,
        count: wallets.length,
        wallets: wallets.map((w) => ({
          requestId: w.requestId.toString(),
          walletAddress: w.walletAddress,
          tier: w.tier,
          estimatedValue: w.estimatedValue.toString(),
          actualValue: w.actualValue,
          tokens: w.tokens,
          createdAt: w.createdAt,
          retrieved: w.retrieved,
          retrievedAt: w.retrievedAt,
          retrievalCount: w.retrievalCount,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching wallets:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch wallets",
    });
  }
});

/**
 * Check wallet preparation status by request ID
 * No authentication required (doesn't return credentials)
 *
 * GET /api/wallet/:requestId/status
 */
app.get("/api/wallet/:requestId/status", async (req, res) => {
  try {
    const { requestId } = req.params;

    // Validate request ID format
    const requestIdBigInt = BigInt(requestId);
    if (requestIdBigInt < 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid request ID",
      });
    }

    // Check if wallet exists in database (without retrieving credentials)
    // We'll use a lightweight query to check existence
    const { data, error } = await supabase
      .from("wallets")
      .select("wallet_address, created_at")
      .eq("request_id", requestIdBigInt.toString())
      .limit(1)
      .single();

    if (data && !error) {
      // Wallet is ready
      return res.json({
        success: true,
        data: {
          ready: true,
          status: "ready",
          walletAddress: data.wallet_address,
          createdAt: data.created_at,
        },
      });
    } else {
      // Wallet not ready yet
      return res.json({
        success: true,
        data: {
          ready: false,
          status: "processing",
        },
      });
    }
  } catch (error) {
    console.error("Error checking wallet status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check wallet status",
    });
  }
});

/**
 * Retrieve wallet credentials by request ID
 * Requires signature verification to prove ownership
 *
 * POST /api/wallet/:requestId
 * Body: { signature, message }
 *
 * The message should be: "Retrieve wallet for request {requestId}"
 * Signature should be signed by the buyer's wallet
 */
app.post("/api/wallet/:requestId", walletLimiter, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { signature, message, address } = req.body;

    // Validate inputs
    if (!signature || !message || !address) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: signature, message, address",
      });
    }

    // Validate request ID format
    const requestIdBigInt = BigInt(requestId);
    if (requestIdBigInt < 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid request ID",
      });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: "Invalid Ethereum address format",
      });
    }

    // Expected message format
    const expectedMessage = `Retrieve wallet for request ${requestId}`;
    if (message !== expectedMessage) {
      return res.status(400).json({
        success: false,
        error: "Invalid message format",
        expected: expectedMessage,
      });
    }

    // Verify signature
    let isValid = false;
    try {
      isValid = await verifyMessage({
        address: address,
        message: message,
        signature: signature,
      });
    } catch (error) {
      console.error("Signature verification error:", error);
      return res.status(401).json({
        success: false,
        error: "Invalid signature",
      });
    }

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: "Signature verification failed",
      });
    }

    // Retrieve wallet from database
    const wallet = await getWallet(requestIdBigInt, address);

    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: "Wallet not found or you are not the buyer",
      });
    }

    // Return decrypted credentials
    res.json({
      success: true,
      data: {
        requestId: wallet.requestId.toString(),
        buyer: wallet.buyer,
        walletAddress: wallet.walletAddress,
        privateKey: wallet.privateKey,
        mnemonic: wallet.mnemonic,
        tier: wallet.tier,
        estimatedValue: wallet.estimatedValue.toString(),
        actualValue: wallet.actualValue,
        tokens: wallet.tokens,
        createdAt: wallet.createdAt,
        retrieved: wallet.retrieved,
        retrievedAt: wallet.retrievedAt,
        retrievalCount: wallet.retrievalCount,
      },
    });

    console.log(`✅ Wallet ${wallet.walletAddress} retrieved by ${address}`);
  } catch (error) {
    console.error("Error retrieving wallet:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve wallet",
    });
  }
});

/**
 * Catch-all for undefined routes
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
  });
});

/**
 * Global error handler
 */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

/**
 * Start the server
 */
export function startApiServer() {
  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(PORT, () => {
        console.log(`✅ API server listening on port ${PORT}`);
        console.log(`📍 Health check: http://localhost:${PORT}/health`);
        resolve(server);
      });

      server.on("error", (error) => {
        console.error("❌ Failed to start API server:", error);
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Stop the server gracefully
 */
export function stopApiServer(server) {
  return new Promise((resolve) => {
    server.close(() => {
      console.log("👋 API server closed");
      resolve();
    });
  });
}

// If running directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  startApiServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}

export default app;
