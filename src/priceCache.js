/**
 * Price Cache Service
 *
 * Periodically fetches and caches token prices and balances from TokenTreasury
 * This eliminates the need to fetch prices during wallet funding
 */

import {
  createPublicClient,
  http,
  parseAbi,
  formatUnits,
  formatEther,
} from "viem";
import { base } from "viem/chains";
import { getTokenPrices } from "./priceOracle.js";
import fetch from "node-fetch";
import * as dotenv from "dotenv";
import {
  TokenTreasuryAbi,
  TokenTreasuryAddress,
  SponsorAunctionAbi,
  SponsorAunctionAddress,
} from "./constant.js";

dotenv.config();

// Environment variables
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const TOKEN_TREASURY_ADDRESS = TokenTreasuryAddress;
const SPONSOR_AUCTION_ADDRESS = SponsorAunctionAddress;

// Public client for reading blockchain data
const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

// Contract ABIs
const TOKEN_TREASURY_ABI = TokenTreasuryAbi;
const SPONSOR_AUCTION_ABI = SponsorAunctionAbi;

// ETH amount sent with each wallet (0.00007 ETH = 70000000000000 wei)
const ETH_AMOUNT_WEI = 70000000000000n;

// ERC20 ABI (minimal)
const ERC20_ABI = parseAbi([
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
]);

// Cache storage
let priceCache = {
  tokens: [], // Array of { address, symbol, name, decimals, balance, balanceFormatted, price, value }
  lastUpdate: null,
  nextUpdate: null,
};

// Update interval (5 minutes)
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
let updateTimer = null;

/**
 * Fetch token metadata (symbol, decimals, name)
 */
async function getTokenMetadata(tokenAddress) {
  try {
    const [symbol, decimals, name] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "name",
      }),
    ]);

    return { symbol, decimals, name };
  } catch (error) {
    console.error(
      `Error fetching metadata for ${tokenAddress}:`,
      error.message
    );
    return { symbol: "UNKNOWN", decimals: 18, name: "Unknown Token" };
  }
}

/**
 * Update the price cache
 */
async function updatePriceCache() {
  try {
    console.log("🔄 Updating price cache...");

    // 1. Get active sponsors from SponsorAuction (these are the tokens we're distributing)
    const activeSponsors = await publicClient.readContract({
      address: SPONSOR_AUCTION_ADDRESS,
      abi: SPONSOR_AUCTION_ABI,
      functionName: "getActiveSponsors",
    });

    if (!activeSponsors || activeSponsors.length === 0) {
      console.log("⚠️  No active sponsors found in SponsorAuction");
      return;
    }

    console.log(`   - Found ${activeSponsors.length} active sponsor tokens`);

    // 2. Fetch metadata and balances for all sponsor tokens in parallel
    const tokenDataPromises = activeSponsors.map(async (tokenAddress) => {
      try {
        // Get metadata and balance
        const [metadata, balance] = await Promise.all([
          getTokenMetadata(tokenAddress),
          publicClient.readContract({
            address: TOKEN_TREASURY_ADDRESS,
            abi: TOKEN_TREASURY_ABI,
            functionName: "getTokenBalance",
            args: [tokenAddress],
          }),
        ]);

        const balanceFormatted = formatUnits(balance, metadata.decimals);

        return {
          address: tokenAddress.toLowerCase(),
          symbol: metadata.symbol,
          name: metadata.name,
          decimals: metadata.decimals,
          balance: balance.toString(),
          balanceFormatted: parseFloat(balanceFormatted),
        };
      } catch (error) {
        console.error(
          `Error fetching data for ${tokenAddress}:`,
          error.message
        );
        return null;
      }
    });

    const tokensData = (await Promise.all(tokenDataPromises)).filter(Boolean);

    // 3. Add ETH to the tokens list
    const ethBalance = await publicClient.getBalance({
      address: TOKEN_TREASURY_ADDRESS,
    });

    const ethBalanceFormatted = parseFloat(formatEther(ethBalance));
    const ethAmountPerWallet = parseFloat(formatEther(ETH_AMOUNT_WEI));

    const ethData = {
      address: "0x0000000000000000000000000000000000000000", // ETH address
      symbol: "ETH",
      name: "Ethereum",
      decimals: 18,
      balance: ethBalance.toString(),
      balanceFormatted: ethBalanceFormatted,
      amountPerWallet: ethAmountPerWallet, // 0.00007 ETH
    };

    // 4. Fetch prices for all tokens
    const tokenAddresses = tokensData.map((t) => t.address);
    const prices = await getTokenPrices(tokenAddresses);

    // 5. Fetch ETH price separately (use CoinGecko API directly)
    let ethPrice = 0;
    try {
      const ethResponse = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
      );
      const ethPriceData = await ethResponse.json();
      ethPrice = ethPriceData?.ethereum?.usd || 0;
    } catch (error) {
      console.error("Error fetching ETH price:", error.message);
    }

    // Add price and value to ETH data
    const ethValue = ethBalanceFormatted * ethPrice;
    const ethWithPrice = {
      ...ethData,
      price: ethPrice,
      value: ethValue,
      valueFormatted: `$${ethValue.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
      walletValue: ethAmountPerWallet * ethPrice, // Value of ETH per wallet
    };

    // 6. Combine data and calculate values for tokens
    const tokensWithPrices = tokensData.map((token) => {
      const price = prices[token.address] || 0;
      const value = token.balanceFormatted * price;

      return {
        ...token,
        price: price,
        value: value,
        valueFormatted: `$${value.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
      };
    });

    // Add ETH to the beginning of the array
    const allTokens = [ethWithPrice, ...tokensWithPrices];

    // 7. Update cache
    const totalValue = allTokens.reduce((sum, t) => sum + t.value, 0);

    priceCache = {
      tokens: allTokens,
      lastUpdate: new Date().toISOString(),
      nextUpdate: new Date(Date.now() + UPDATE_INTERVAL).toISOString(),
      totalValue: totalValue,
      tokenCount: allTokens.length,
      ethAmountPerWallet: ethAmountPerWallet,
      ethAmountWei: ETH_AMOUNT_WEI.toString(),
    };

    console.log("✅ Price cache updated successfully");
    console.log(`   - ${allTokens.length} tokens cached (including ETH)`);
    console.log(
      `   - Total treasury value: $${priceCache.totalValue.toLocaleString(
        "en-US",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }
      )}`
    );
    console.log(`   - Next update: ${priceCache.nextUpdate}`);
  } catch (error) {
    console.error("❌ Error updating price cache:", error.message);
    console.error(error);
  }
}

/**
 * Start the price cache service
 */
export function startPriceCache() {
  console.log("🚀 Starting price cache service...");
  console.log(
    `   - Update interval: ${UPDATE_INTERVAL / 1000}s (${UPDATE_INTERVAL / 60000} minutes)`
  );

  // Initial update
  updatePriceCache().then(() => {
    // Schedule periodic updates
    updateTimer = setInterval(updatePriceCache, UPDATE_INTERVAL);
  });
}

/**
 * Stop the price cache service
 */
export function stopPriceCache() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
    console.log("⏹️  Price cache service stopped");
  }
}

/**
 * Get cached token data
 */
export function getCachedPrices() {
  return priceCache;
}

/**
 * Get price for a specific token
 */
export function getCachedTokenPrice(tokenAddress) {
  const token = priceCache.tokens?.find(
    (t) => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  return token?.price || null;
}

/**
 * Get balance for a specific token
 */
export function getCachedTokenBalance(tokenAddress) {
  const token = priceCache.tokens?.find(
    (t) => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  return token?.balanceFormatted || null;
}

/**
 * Get token data for a specific token
 */
export function getCachedToken(tokenAddress) {
  return (
    priceCache.tokens?.find(
      (t) => t.address.toLowerCase() === tokenAddress.toLowerCase()
    ) || null
  );
}

/**
 * Force a cache update (useful for debugging)
 */
export async function forceUpdateCache() {
  console.log("🔄 Forcing price cache update...");
  await updatePriceCache();
  return priceCache;
}
