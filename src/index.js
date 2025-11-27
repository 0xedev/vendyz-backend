/**
 * Vendyz Backend Service - Wallet Funding Service
 *
 * Listens for WalletReady events from VendingMachine contract
 * Generates new wallets and funds them with tokens from TokenTreasury
 *
 * Flow:
 * 1. Listen for WalletReady event (requestId, buyer, tier, estimatedValue)
 * 2. Generate new wallet (address + private key + seed phrase)
 * 3. Select tokens based on tier and sponsor/random mix
 * 4. Call TokenTreasury.fundWallet() to transfer tokens
 * 5. Store encrypted credentials in database
 * 6. Emit confirmation
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatEther,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { generateMnemonic, mnemonicToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
import {
  getTokenPrice,
  getTokenPrices,
  calculateWalletValue,
} from "./priceOracle.js";
import {
  initializeDatabase,
  storeWallet,
  testConnection,
  closeDatabase,
  startAutoCleanup,
  stopAutoCleanup,
} from "./database.js";
import { startApiServer, stopApiServer } from "./api.js";
import {
  startPriceCache,
  stopPriceCache,
  getCachedTokenPrice,
} from "./priceCache.js";

dotenv.config();

// Environment variables
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY;
const VENDING_MACHINE_ADDRESS = process.env.VENDING_MACHINE_ADDRESS;
const TOKEN_TREASURY_ADDRESS = process.env.TOKEN_TREASURY_ADDRESS;
const SPONSOR_AUCTION_ADDRESS = process.env.SPONSOR_AUCTION_ADDRESS;
const USDC_ADDRESS = process.env.USDC_ADDRESS;

if (!BACKEND_PRIVATE_KEY) {
  console.error("❌ BACKEND_PRIVATE_KEY not set in .env");
  process.exit(1);
}

// Initialize clients
const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

const account = privateKeyToAccount(BACKEND_PRIVATE_KEY);

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(BASE_RPC_URL),
});

console.log("✅ Backend service initialized");
console.log(`📝 Backend address: ${account.address}`);
console.log(`🔗 Connected to Base mainnet`);

// Contract ABIs (minimal for events and functions we need)
const vendingMachineAbi = parseAbi([
  "event WalletReady(uint256 indexed requestId, address indexed buyer, uint8 tier, uint256 estimatedValue)",
  "function getPurchase(uint256 requestId) view returns (address buyer, uint8 tier, uint256 timestamp, uint256 pricePaid, bool fulfilled, uint256[] randomWords)",
]);

const tokenTreasuryAbi = parseAbi([
  "function fundWallet(address wallet, address[] calldata tokens, uint256[] calldata amounts, uint256 requestId) external",
  "function getTokenBalance(address token) view returns (uint256)",
  "function isAuthorizedBackend(address backend) view returns (bool)",
]);

const sponsorAuctionAbi = parseAbi([
  "function getActiveSponsors() view returns (address[] memory)",
  "function getCurrentAuction() view returns (uint256 auctionId, uint256 startTime, uint256 endTime, bool active)",
  "function getUserBid(address user) view returns (uint256)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/**
 * Generate a new wallet with mnemonic
 */
function generateNewWallet() {
  const mnemonic = generateMnemonic("english");
  const account = mnemonicToAccount(mnemonic);

  return {
    address: account.address,
    privateKey: account.getHdKey().privateKey,
    mnemonic: mnemonic,
  };
}

/**
 * Get all tokens with non-zero balance in TokenTreasury
 */
async function getAvailableTokensInTreasury() {
  // Common Base tokens to check - expand this list as needed
  const tokensToCheck = [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
    "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DEGEN
    "0x4200000000000000000000000000000000000006", // WETH
    "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
    "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // cbETH
    "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
    "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
  ];

  const availableTokens = [];

  for (const tokenAddress of tokensToCheck) {
    try {
      const balance = await publicClient.readContract({
        address: TOKEN_TREASURY_ADDRESS,
        abi: tokenTreasuryAbi,
        functionName: "getTokenBalance",
        args: [tokenAddress],
      });

      if (balance > 0n) {
        const decimals = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "decimals",
        });

        const symbol = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "symbol",
        });

        availableTokens.push({
          address: tokenAddress,
          balance,
          decimals,
          symbol,
        });
      }
    } catch (error) {
      // Skip tokens that fail (might not exist or have issues)
      continue;
    }
  }

  return availableTokens;
}

/**
 * Select tokens to fund based on tier
 * Uses only tokens available in TokenTreasury
 * Prioritizes sponsor tokens (50%), fills rest with available treasury tokens
 */
async function selectTokensForTier(tier, estimatedValue) {
  try {
    console.log(`  🎯 Selecting tokens for tier ${tier}...`);
    console.log(`  💰 Target value: $${Number(estimatedValue) / 1e6} USDC`);

    // 1. Get available tokens in TokenTreasury
    console.log("  📦 Checking TokenTreasury balances...");
    const availableTokens = await getAvailableTokensInTreasury();
    console.log(
      `  ✅ Found ${availableTokens.length} tokens with balance in treasury`
    );

    if (availableTokens.length === 0) {
      throw new Error("No tokens available in TokenTreasury");
    }

    // 2. Get active sponsors from SponsorAuction
    let sponsorTokens = [];
    try {
      sponsorTokens = await publicClient.readContract({
        address: SPONSOR_AUCTION_ADDRESS,
        abi: sponsorAuctionAbi,
        functionName: "getActiveSponsors",
      });
      console.log(`  📢 Active sponsors: ${sponsorTokens.length}`);
    } catch (error) {
      console.warn("  ⚠️  Could not fetch sponsors:", error.message);
      sponsorTokens = [];
    }

    // 3. Filter available tokens by sponsor status
    const sponsorTokensInTreasury = availableTokens.filter((token) =>
      sponsorTokens.includes(token.address)
    );
    const nonSponsorTokens = availableTokens.filter(
      (token) => !sponsorTokens.includes(token.address)
    );

    console.log(
      `  💼 Sponsor tokens in treasury: ${sponsorTokensInTreasury.length}`
    );
    console.log(
      `  🎲 Non-sponsor tokens in treasury: ${nonSponsorTokens.length}`
    );

    // 4. Allocate value (50% sponsors, 50% other tokens)
    const targetValueInUSD = Number(estimatedValue) / 1e6;
    const sponsorValue = targetValueInUSD * 0.5;
    const otherValue = targetValueInUSD * 0.5;

    const selectedTokens = [];
    const selectedAmounts = [];

    // 5. Add sponsor tokens (equal distribution among sponsors)
    if (sponsorTokensInTreasury.length > 0) {
      const valuePerSponsor = sponsorValue / sponsorTokensInTreasury.length;

      for (const token of sponsorTokensInTreasury) {
        try {
          // Get token price
          const priceData = await getTokenPrice(token.address);
          const tokenPrice = priceData.price;

          if (tokenPrice === 0) {
            console.warn(
              `  ⚠️  Skipping sponsor ${token.symbol}: price unavailable`
            );
            continue;
          }

          // Calculate amount: (valueInUSD / price) * 10^decimals
          const tokenAmount = Math.floor(
            (valuePerSponsor / tokenPrice) * 10 ** token.decimals
          );

          // Check if treasury has enough balance
          if (BigInt(tokenAmount) > token.balance) {
            console.warn(
              `  ⚠️  Insufficient balance for ${token.symbol}: need ${tokenAmount}, have ${token.balance}`
            );
            // Use all available balance
            selectedTokens.push(token.address);
            selectedAmounts.push(token.balance);
            const actualValue =
              (Number(token.balance) / 10 ** token.decimals) * tokenPrice;
            console.log(
              `    ✅ Sponsor: ${token.symbol} - ${Number(token.balance) / 10 ** token.decimals} tokens (~$${actualValue.toFixed(2)}) [ALL AVAILABLE]`
            );
          } else {
            selectedTokens.push(token.address);
            selectedAmounts.push(BigInt(tokenAmount));
            console.log(
              `    ✅ Sponsor: ${token.symbol} - ${tokenAmount / 10 ** token.decimals} tokens (~$${valuePerSponsor.toFixed(2)})`
            );
          }
        } catch (error) {
          console.warn(
            `  ⚠️  Error processing sponsor ${token.symbol}:`,
            error.message
          );
        }
      }
    } else if (sponsorTokens.length > 0) {
      console.warn("  ⚠️  Sponsors exist but none have balance in treasury");
      // Redistribute sponsor value to other tokens
      console.log("  🔄 Redistributing sponsor allocation to other tokens");
    }

    // 6. Add non-sponsor tokens (equal distribution, up to 3 tokens)
    const numOtherTokens = Math.min(3, nonSponsorTokens.length);
    if (numOtherTokens > 0 && otherValue > 0) {
      const valuePerToken = otherValue / numOtherTokens;

      // Shuffle and select tokens
      const shuffled = [...nonSponsorTokens].sort(() => Math.random() - 0.5);
      const selectedOther = shuffled.slice(0, numOtherTokens);

      for (const token of selectedOther) {
        try {
          // Get token price
          const priceData = await getTokenPrice(token.address);
          const tokenPrice = priceData.price;

          if (tokenPrice === 0) {
            console.warn(`  ⚠️  Skipping ${token.symbol}: price unavailable`);
            continue;
          }

          // Calculate amount
          const tokenAmount = Math.floor(
            (valuePerToken / tokenPrice) * 10 ** token.decimals
          );

          // Check if treasury has enough balance
          if (BigInt(tokenAmount) > token.balance) {
            console.warn(
              `  ⚠️  Insufficient balance for ${token.symbol}: need ${tokenAmount}, have ${token.balance}`
            );
            // Use all available balance
            selectedTokens.push(token.address);
            selectedAmounts.push(token.balance);
            const actualValue =
              (Number(token.balance) / 10 ** token.decimals) * tokenPrice;
            console.log(
              `    ✅ Treasury: ${token.symbol} - ${Number(token.balance) / 10 ** token.decimals} tokens (~$${actualValue.toFixed(2)}) [ALL AVAILABLE]`
            );
          } else {
            selectedTokens.push(token.address);
            selectedAmounts.push(BigInt(tokenAmount));
            console.log(
              `    ✅ Treasury: ${token.symbol} - ${tokenAmount / 10 ** token.decimals} tokens (~$${valuePerToken.toFixed(2)})`
            );
          }
        } catch (error) {
          console.warn(
            `  ⚠️  Error processing ${token.symbol}:`,
            error.message
          );
        }
      }
    }

    // Fallback: If no tokens selected, use USDC (or first available token)
    if (selectedTokens.length === 0) {
      console.warn("  ⚠️  No tokens selected, using fallback");
      const fallbackToken = availableTokens[0];
      if (fallbackToken) {
        // Use minimum of requested amount or available balance
        const requestedAmount = estimatedValue;
        const availableAmount = fallbackToken.balance;
        const amountToUse =
          requestedAmount < availableAmount ? requestedAmount : availableAmount;

        selectedTokens.push(fallbackToken.address);
        selectedAmounts.push(amountToUse);
        console.log(
          `    ✅ Fallback: ${fallbackToken.symbol} - ${Number(amountToUse) / 10 ** fallbackToken.decimals} tokens`
        );
      } else {
        throw new Error("No tokens available for fallback");
      }
    }

    // Calculate actual total value
    const actualValue = await calculateWalletValue(
      selectedTokens.map((token, i) => ({
        address: token,
        balance: selectedAmounts[i].toString(),
      }))
    );

    console.log(
      "  💰 Total value: $${actualValue.totalValue.toFixed(2)} (target: $${targetValueInUSD.toFixed(2)})"
    );
    console.log("  📦 Selected ${selectedTokens.length} tokens\n");

    return { tokens: selectedTokens, amounts: selectedAmounts };
  } catch (error) {
    console.error("  ❌ Error in token selection:", error);
    // Fallback to USDC only
    console.log("  🔄 Falling back to USDC only");
    return {
      tokens: [USDC_ADDRESS],
      amounts: [estimatedValue],
    };
  }
}

/**
 * Fund a wallet with tokens from TokenTreasury
 */
async function fundWallet(walletAddress, tokens, amounts, requestId) {
  try {
    console.log(`💰 Funding wallet ${walletAddress}...`);
    console.log(`📦 Tokens: ${tokens.length}`);
    console.log(
      `💵 Total value: ${formatEther(amounts.reduce((a, b) => a + b, 0n))} ETH equivalent`
    );

    // Check if backend is authorized
    const isAuthorized = await publicClient.readContract({
      address: TOKEN_TREASURY_ADDRESS,
      abi: tokenTreasuryAbi,
      functionName: "isAuthorizedBackend",
      args: [account.address],
    });

    if (!isAuthorized) {
      throw new Error("Backend address not authorized in TokenTreasury");
    }

    // Call fundWallet on TokenTreasury
    const hash = await walletClient.writeContract({
      address: TOKEN_TREASURY_ADDRESS,
      abi: tokenTreasuryAbi,
      functionName: "fundWallet",
      args: [walletAddress, tokens, amounts, requestId],
    });

    console.log(`✅ Fund transaction sent: ${hash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Wallet funded successfully! Block: ${receipt.blockNumber}`);

    return receipt;
  } catch (error) {
    console.error("❌ Error funding wallet:", error);
    throw error;
  }
}

/**
 * Store wallet credentials (encrypted in database)
 */
async function storeWalletCredentials(
  requestId,
  buyer,
  walletData,
  tier,
  estimatedValue,
  actualValue,
  tokens
) {
  try {
    console.log(`💾 Storing credentials for request ${requestId}...`);

    await storeWallet({
      requestId,
      buyer,
      walletAddress: walletData.address,
      privateKey: walletData.privateKey,
      mnemonic: walletData.mnemonic,
      tier,
      estimatedValue,
      actualValue,
      tokens,
    });

    console.log(`✅ Credentials stored securely`);
  } catch (error) {
    console.error("❌ Error storing credentials:", error);
    throw error;
  }
}

/**
 * Handle WalletReady event
 */
async function handleWalletReady(log) {
  const { requestId, buyer, tier, estimatedValue } = log.args;

  console.log("\n🎉 WalletReady event received!");
  console.log(`📋 Request ID: ${requestId}`);
  console.log(`👤 Buyer: ${buyer}`);
  console.log(`🎯 Tier: ${tier}`);
  console.log(`💰 Estimated Value: $${Number(estimatedValue) / 1e6} USDC`);

  try {
    // 1. Generate new wallet
    console.log("🔨 Generating new wallet...");
    const walletData = generateNewWallet();
    console.log(`✅ Wallet generated: ${walletData.address}`);

    // 2. Select tokens for tier
    console.log("🎲 Selecting tokens...");
    const { tokens, amounts } = await selectTokensForTier(tier, estimatedValue);
    console.log(`✅ Selected ${tokens.length} tokens`);

    // 3. Fund wallet from TokenTreasury
    await fundWallet(walletData.address, tokens, amounts, requestId);

    // 4. Calculate actual value of funded tokens
    const tokenData = tokens.map((tokenAddress, i) => ({
      address: tokenAddress,
      amount: amounts[i].toString(),
    }));

    const valueData = await calculateWalletValue(tokenData);
    const actualValue = valueData.totalValue;

    console.log(`💰 Actual funded value: $${actualValue.toFixed(2)}`);

    // 5. Store credentials in database
    const tokensWithDetails = valueData.tokens.map((token) => ({
      address: token.address,
      symbol: token.symbol,
      amount: token.amount,
      price: token.price,
      value: token.value,
    }));

    await storeWalletCredentials(
      requestId,
      buyer,
      walletData,
      tier,
      estimatedValue,
      actualValue,
      tokensWithDetails
    );

    console.log("✅ Wallet funding complete!\n");
  } catch (error) {
    console.error("❌ Error handling WalletReady event:", error);
    // TODO: Implement retry logic or alert system
  }
}

/**
 * Start listening for WalletReady events
 */
async function startEventListener() {
  console.log("\n👂 Starting event listener...");
  console.log(`📍 VendingMachine: ${VENDING_MACHINE_ADDRESS}`);
  console.log(`📍 TokenTreasury: ${TOKEN_TREASURY_ADDRESS}`);

  // Watch for WalletReady events
  const unwatch = publicClient.watchContractEvent({
    address: VENDING_MACHINE_ADDRESS,
    abi: vendingMachineAbi,
    eventName: "WalletReady",
    onLogs: (logs) => {
      logs.forEach(handleWalletReady);
    },
    onError: (error) => {
      console.error("❌ Event listener error:", error);
    },
  });

  console.log("✅ Event listener started successfully!");
  console.log("⏳ Waiting for WalletReady events...\n");

  return unwatch;
}

// Start the service
let apiServer;
let unwatchEvents;

(async () => {
  try {
    console.log("\n🚀 Starting Vendyz Backend Service...\n");

    // 1. Test database connection
    console.log("📦 Testing database connection...");
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error("Database connection failed");
    }

    // 2. Initialize database schema
    await initializeDatabase();

    // 3. Start auto-cleanup of old wallet credentials (5 minute TTL)
    console.log("\n🔒 Starting auto-cleanup for wallet credentials...");
    startAutoCleanup();

    // 4. Start price cache service
    console.log("\n💰 Starting price cache service...");
    startPriceCache();

    // 5. Start API server
    console.log("\n🌐 Starting API server...");
    apiServer = await startApiServer();

    // 6. Start event listener
    console.log("\n");
    unwatchEvents = await startEventListener();

    console.log("✅ All services started successfully!\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Vendyz Backend is now running");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (error) {
    console.error("❌ Failed to start service:", error);
    process.exit(1);
  }
})();

// Graceful shutdown
async function shutdown() {
  console.log("\n⛔ Shutting down gracefully...");

  if (unwatchEvents) {
    unwatchEvents();
    console.log("✅ Event listener stopped");
  }

  if (apiServer) {
    await stopApiServer(apiServer);
  }

  stopPriceCache();
  stopAutoCleanup();
  await closeDatabase();

  console.log("👋 Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
