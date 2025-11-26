/**
 * Price Oracle Service
 *
 * Fetches token prices using CoinGecko (primary) and Moralis (fallback)
 * Implements 5-minute caching to avoid rate limits
 */

// Import fetch for Node.js < 18 compatibility
import fetch from "node-fetch";

// API Configuration (Demo API Key)
const COINGECKO_API_KEY = "CG-dWqQuUYppVGZs9SnRkQw6quj";
const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

// Price cache with 5-minute TTL
const priceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Rate limiting
let lastCoinGeckoCall = 0;
let lastMoralisCall = 0;
const COINGECKO_RATE_LIMIT = 1200; // 1.2s between calls (50 calls/min)
const MORALIS_RATE_LIMIT = 500; // 0.5s between calls

/**
 * Fetch price from CoinGecko (primary)
 */
async function fetchFromCoinGecko(tokenAddresses) {
  try {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastCall = now - lastCoinGeckoCall;
    if (timeSinceLastCall < COINGECKO_RATE_LIMIT) {
      await new Promise((resolve) =>
        setTimeout(resolve, COINGECKO_RATE_LIMIT - timeSinceLastCall)
      );
    }
    lastCoinGeckoCall = Date.now();

    // Format addresses for CoinGecko (lowercase, comma-separated)
    const addressList = Array.isArray(tokenAddresses)
      ? tokenAddresses.map((a) => a.toLowerCase()).join(",")
      : tokenAddresses.toLowerCase();

    const url = `${COINGECKO_API_URL}/simple/token_price/base?contract_addresses=${addressList}&vs_currencies=usd`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-cg-demo-api-key": COINGECKO_API_KEY,
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `CoinGecko API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Transform to standardized format
    const prices = {};
    for (const [address, priceData] of Object.entries(data)) {
      prices[address.toLowerCase()] = priceData.usd || 0;
    }

    return { success: true, prices, source: "coingecko" };
  } catch (error) {
    console.error("CoinGecko fetch error:", error.message || error);
    console.error("Error details:", error.cause || error.stack);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Fetch price from Moralis (fallback)
 */
async function fetchFromMoralis(tokenAddress) {
  try {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastCall = now - lastMoralisCall;
    if (timeSinceLastCall < MORALIS_RATE_LIMIT) {
      await new Promise((resolve) =>
        setTimeout(resolve, MORALIS_RATE_LIMIT - timeSinceLastCall)
      );
    }
    lastMoralisCall = Date.now();

    const url = `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/price?chain=base`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-API-Key":
          process.env.MORALIS_API_KEY ||
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6Ijk1MjY1NDM1LWI1OTItNDA3ZS04NDY2LTVmYTkzOGJlNjEzOCIsIm9yZ0lkIjoiNDU1OTQzIiwidXNlcklkIjoiNDY5MTA2IiwidHlwZUlkIjoiOTY4ZjM3ZmEtM2NkMi00MTQ1LWJhMTAtY2FmOWRmZWU0ZGZiIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NTA5NTgwMTksImV4cCI6NDkwNjcxODAxOX0.oCAn6T8gPV1-tiOd0Bfwsg8ANgIu6t2HFBe0YgXeOxE",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Moralis API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Moralis response format: { usdPrice: 0.123, ... }
    const price = data.usdPrice || data.usdPriceFormatted || 0;

    return {
      success: true,
      prices: { [tokenAddress.toLowerCase()]: price },
      source: "moralis",
    };
  } catch (error) {
    console.error("Moralis fetch error:", error.message || error);
    console.error("Error details:", error.cause || error.stack);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get price from cache or fetch new
 */
async function getCachedPrice(tokenAddress) {
  const now = Date.now();
  const cached = priceCache.get(tokenAddress.toLowerCase());

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return { price: cached.price, cached: true, source: cached.source };
  }

  return null;
}

/**
 * Set price in cache
 */
function setCachePrice(tokenAddress, price, source) {
  priceCache.set(tokenAddress.toLowerCase(), {
    price,
    source,
    timestamp: Date.now(),
  });
}

/**
 * Get single token price (with fallback)
 */
export async function getTokenPrice(tokenAddress) {
  try {
    // Check cache first
    const cached = await getCachedPrice(tokenAddress);
    if (cached) {
      return cached;
    }

    // Try CoinGecko first
    const cgResult = await fetchFromCoinGecko(tokenAddress);
    if (cgResult.success && cgResult.prices[tokenAddress.toLowerCase()]) {
      const price = cgResult.prices[tokenAddress.toLowerCase()];
      setCachePrice(tokenAddress, price, "coingecko");
      return { price, cached: false, source: "coingecko" };
    }

    console.log(`⚠️  CoinGecko failed for ${tokenAddress}, trying Moralis...`);

    // Fallback to Moralis
    const moralisResult = await fetchFromMoralis(tokenAddress);
    if (
      moralisResult.success &&
      moralisResult.prices[tokenAddress.toLowerCase()]
    ) {
      const price = moralisResult.prices[tokenAddress.toLowerCase()];
      setCachePrice(tokenAddress, price, "moralis");
      return { price, cached: false, source: "moralis" };
    }

    // Both failed
    console.error(`❌ Both price sources failed for ${tokenAddress}`);
    return {
      price: 0,
      cached: false,
      source: "none",
      error: "All sources failed",
    };
  } catch (error) {
    console.error("Error in getTokenPrice:", error);
    return { price: 0, cached: false, source: "none", error: error.message };
  }
}

/**
 * Get multiple token prices (batch)
 * Uses CoinGecko batch endpoint, falls back to individual Moralis calls
 */
export async function getTokenPrices(tokenAddresses) {
  try {
    const results = {};
    const uncachedAddresses = [];

    // Check cache for all addresses
    for (const address of tokenAddresses) {
      const cached = await getCachedPrice(address);
      if (cached) {
        results[address.toLowerCase()] = cached;
      } else {
        uncachedAddresses.push(address);
      }
    }

    // If all cached, return
    if (uncachedAddresses.length === 0) {
      return results;
    }

    // Try CoinGecko batch fetch for uncached addresses
    const cgResult = await fetchFromCoinGecko(uncachedAddresses);
    if (cgResult.success) {
      for (const [address, price] of Object.entries(cgResult.prices)) {
        if (price > 0) {
          setCachePrice(address, price, "coingecko");
          results[address] = { price, cached: false, source: "coingecko" };
        }
      }
    }

    // For any remaining addresses without prices, try Moralis individually
    for (const address of uncachedAddresses) {
      if (
        !results[address.toLowerCase()] ||
        results[address.toLowerCase()].price === 0
      ) {
        console.log(`⚠️  Trying Moralis for ${address}...`);
        const moralisResult = await fetchFromMoralis(address);
        if (
          moralisResult.success &&
          moralisResult.prices[address.toLowerCase()]
        ) {
          const price = moralisResult.prices[address.toLowerCase()];
          setCachePrice(address, price, "moralis");
          results[address.toLowerCase()] = {
            price,
            cached: false,
            source: "moralis",
          };
        } else {
          results[address.toLowerCase()] = {
            price: 0,
            cached: false,
            source: "none",
            error: "All sources failed",
          };
        }
      }
    }

    return results;
  } catch (error) {
    console.error("Error in getTokenPrices:", error);
    return {};
  }
}

/**
 * Calculate total USD value of wallet tokens
 */
export async function calculateWalletValue(tokens) {
  try {
    // tokens format: [{ address: '0x...', amount: '1000000', decimals: 6 }]
    const addresses = tokens.map((t) => t.address);
    const prices = await getTokenPrices(addresses);

    let totalValue = 0;
    const tokenValues = [];

    for (const token of tokens) {
      const priceData = prices[token.address.toLowerCase()];
      if (priceData && priceData.price > 0) {
        const amount = Number(token.amount) / Math.pow(10, token.decimals);
        const value = amount * priceData.price;
        totalValue += value;

        tokenValues.push({
          address: token.address,
          symbol: token.symbol,
          amount,
          price: priceData.price,
          value,
          source: priceData.source,
        });
      } else {
        tokenValues.push({
          address: token.address,
          symbol: token.symbol,
          amount: Number(token.amount) / Math.pow(10, token.decimals),
          price: 0,
          value: 0,
          source: "none",
          error: "Price not available",
        });
      }
    }

    return {
      totalValue,
      tokens: tokenValues,
    };
  } catch (error) {
    console.error("Error calculating wallet value:", error);
    return { totalValue: 0, tokens: [], error: error.message };
  }
}

/**
 * Clear cache (useful for testing or manual refresh)
 */
export function clearPriceCache() {
  priceCache.clear();
  console.log("✅ Price cache cleared");
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;

  for (const [address, data] of priceCache.entries()) {
    if (now - data.timestamp < CACHE_TTL) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }

  return {
    total: priceCache.size,
    valid: validEntries,
    expired: expiredEntries,
    ttl: CACHE_TTL / 1000,
  };
}
