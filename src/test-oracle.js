/**
 * Test Price Oracle
 *
 * Tests CoinGecko and Moralis price fetching with fallback logic
 */

import {
  getTokenPrice,
  getTokenPrices,
  calculateWalletValue,
  getCacheStats,
  clearPriceCache,
} from "./priceOracle.js";

// Base mainnet token addresses
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEGEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const WETH = "0x4200000000000000000000000000000000000006";

console.log("🧪 Testing Price Oracle\n");
console.log("━".repeat(60));

// Test 1: Single token price
console.log("\n📊 Test 1: Fetching single token price (USDC)");
const usdcPrice = await getTokenPrice(USDC);
console.log(`   Price: $${usdcPrice.price}`);
console.log(`   Source: ${usdcPrice.source}`);
console.log(`   Cached: ${usdcPrice.cached}`);

// Test 2: Batch token prices
console.log("\n📊 Test 2: Fetching batch token prices");
const prices = await getTokenPrices([USDC, DEGEN, WETH]);
for (const [address, data] of Object.entries(prices)) {
  console.log(
    `   ${address.slice(0, 10)}... | $${data.price.toFixed(6)} | ${data.source}`
  );
}

// Test 3: Cache functionality
console.log("\n📊 Test 3: Testing cache (refetch USDC)");
const cachedPrice = await getTokenPrice(USDC);
console.log(`   Price: $${cachedPrice.price}`);
console.log(`   Source: ${cachedPrice.source}`);
console.log(`   Cached: ${cachedPrice.cached} ✅`);

// Test 4: Cache stats
console.log("\n📊 Test 4: Cache statistics");
const stats = getCacheStats();
console.log(`   Total entries: ${stats.total}`);
console.log(`   Valid entries: ${stats.valid}`);
console.log(`   Expired entries: ${stats.expired}`);
console.log(`   TTL: ${stats.ttl}s`);

// Test 5: Wallet value calculation
console.log("\n📊 Test 5: Calculate wallet value");
const walletTokens = [
  {
    address: USDC,
    symbol: "USDC",
    amount: "1000000", // 1 USDC (6 decimals)
    decimals: 6,
  },
  {
    address: DEGEN,
    symbol: "DEGEN",
    amount: "10000000000000000000", // 10 DEGEN (18 decimals)
    decimals: 18,
  },
  {
    address: WETH,
    symbol: "WETH",
    amount: "500000000000000000", // 0.5 WETH (18 decimals)
    decimals: 18,
  },
];

const walletValue = await calculateWalletValue(walletTokens);
console.log(`   Total Value: $${walletValue.totalValue.toFixed(2)}`);
console.log("   Breakdown:");
for (const token of walletValue.tokens) {
  console.log(
    `     ${token.symbol}: ${token.amount} × $${token.price.toFixed(4)} = $${token.value.toFixed(2)} (${token.source})`
  );
}

// Test 6: Fallback to Moralis (test with invalid token)
console.log("\n📊 Test 6: Testing Moralis fallback");
clearPriceCache();
console.log("   Cache cleared");
const degenPrice = await getTokenPrice(DEGEN);
console.log(`   DEGEN Price: $${degenPrice.price}`);
console.log(`   Source: ${degenPrice.source}`);

console.log("\n" + "━".repeat(60));
console.log("✅ All tests complete!\n");
