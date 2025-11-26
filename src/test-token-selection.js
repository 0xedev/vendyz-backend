/**
 * Test Token Selection Algorithm
 *
 * This script tests the token selection algorithm without actually
 * funding wallets. Useful for validating configuration and algorithm logic.
 */

import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import * as dotenv from "dotenv";
import { getTokenPrice, getTokenPrices } from "./priceOracle.js";

dotenv.config();

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const SPONSOR_AUCTION_ADDRESS = process.env.SPONSOR_AUCTION_ADDRESS;
const TOKEN_TREASURY_ADDRESS = process.env.TOKEN_TREASURY_ADDRESS;
const USDC_ADDRESS = process.env.USDC_ADDRESS;

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

// Tokens to check for treasury balance
const TOKENS_TO_CHECK = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
  "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DEGEN
  "0x4200000000000000000000000000000000000006", // WETH
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
  "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // cbETH
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
  "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
];

const tokenTreasuryAbi = parseAbi([
  "function getTokenBalance(address token) view returns (uint256)",
]);

const sponsorAuctionAbi = parseAbi([
  "function getActiveSponsors() view returns (address[] memory)",
]);

const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/**
 * Test token selection for a specific tier
 */
async function testTokenSelection(tier, estimatedValueUSDC) {
  const estimatedValue = BigInt(estimatedValueUSDC * 1e6); // Convert to 6 decimals

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🧪 Testing Token Selection - Tier ${tier}`);
  console.log(`💰 Target Value: $${estimatedValueUSDC}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    // 1. Check TokenTreasury balances
    console.log(`📦 Checking TokenTreasury balances...`);
    const availableTokens = [];

    for (const tokenAddress of TOKENS_TO_CHECK) {
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

          console.log(
            `   ✅ ${symbol}: ${Number(balance) / 10 ** decimals} tokens`
          );
        }
      } catch (error) {
        // Skip tokens that fail
        continue;
      }
    }

    console.log(
      `\n✅ Found ${availableTokens.length} tokens with balance in treasury\n`
    );

    if (availableTokens.length === 0) {
      console.error("❌ No tokens available in TokenTreasury!");
      return;
    }

    // 2. Fetch active sponsors
    let sponsorTokens = [];
    try {
      sponsorTokens = await publicClient.readContract({
        address: SPONSOR_AUCTION_ADDRESS,
        abi: sponsorAuctionAbi,
        functionName: "getActiveSponsors",
      });
      console.log(`📢 Active Sponsors: ${sponsorTokens.length}`);
      for (const sponsor of sponsorTokens) {
        try {
          const symbol = await publicClient.readContract({
            address: sponsor,
            abi: erc20Abi,
            functionName: "symbol",
          });
          console.log(`   - ${symbol} (${sponsor})`);
        } catch (error) {
          console.log(`   - ${sponsor}`);
        }
      }
    } catch (error) {
      console.warn(`⚠️  Could not fetch sponsors: ${error.message}`);
    }

    // 3. Categorize tokens
    const sponsorTokensInTreasury = availableTokens.filter((token) =>
      sponsorTokens.includes(token.address)
    );
    const nonSponsorTokens = availableTokens.filter(
      (token) => !sponsorTokens.includes(token.address)
    );

    console.log(
      `\n💼 Sponsor tokens in treasury: ${sponsorTokensInTreasury.length}`
    );
    console.log(
      `🎲 Non-sponsor tokens in treasury: ${nonSponsorTokens.length}`
    );

    // 3. Calculate allocations
    const targetValueInUSD = Number(estimatedValue) / 1e6;
    const sponsorValue = targetValueInUSD * 0.5;
    const randomValue = targetValueInUSD * 0.5;

    console.log(`\n💵 Value Allocation:`);
    console.log(`   Sponsors: $${sponsorValue.toFixed(2)} (50%)`);
    console.log(`   Random: $${randomValue.toFixed(2)} (50%)\n`);

    const selectedTokens = [];
    const selectedAmounts = [];
    const selectedDetails = [];

    // 4. Process sponsor tokens
    if (sponsorTokens.length > 0) {
      console.log(`📊 Processing Sponsor Tokens:\n`);
      const valuePerSponsor = sponsorValue / sponsorTokens.length;

      for (const tokenAddress of sponsorTokens) {
        try {
          const priceData = await getTokenPrice(tokenAddress);
          const tokenPrice = priceData.price;

          if (tokenPrice === 0) {
            console.warn(`   ⚠️  Skipping ${tokenAddress}: price unavailable`);
            continue;
          }

          const decimals = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "decimals",
          });

          const tokenAmount = Math.floor(
            (valuePerSponsor / tokenPrice) * 10 ** decimals
          );

          const symbol = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "symbol",
          });

          selectedTokens.push(tokenAddress);
          selectedAmounts.push(BigInt(tokenAmount));
          selectedDetails.push({
            type: "Sponsor",
            symbol,
            address: tokenAddress,
            amount: tokenAmount / 10 ** decimals,
            value: valuePerSponsor,
            price: tokenPrice,
            source: priceData.source,
          });

          console.log(
            `   ✅ ${symbol.padEnd(8)} | ${(tokenAmount / 10 ** decimals).toFixed(4).padStart(12)} tokens | ~$${valuePerSponsor.toFixed(2).padStart(7)} | $${tokenPrice.toFixed(6)} (${priceData.source})`
          );
        } catch (error) {
          console.warn(
            `   ⚠️  Error processing ${tokenAddress}: ${error.message}`
          );
        }
      }
    }

    // 5. Process random tokens
    const numRandomTokens = Math.min(3, randomTokens.length);
    if (numRandomTokens > 0 && randomValue > 0) {
      console.log(`\n📊 Processing Random Tokens:\n`);
      const valuePerRandom = randomValue / numRandomTokens;

      const shuffled = [...randomTokens].sort(() => Math.random() - 0.5);
      const selectedRandom = shuffled.slice(0, numRandomTokens);

      for (const tokenAddress of selectedRandom) {
        try {
          const priceData = await getTokenPrice(tokenAddress);
          const tokenPrice = priceData.price;

          if (tokenPrice === 0) {
            console.warn(`   ⚠️  Skipping ${tokenAddress}: price unavailable`);
            continue;
          }

          const decimals = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "decimals",
          });

          const tokenAmount = Math.floor(
            (valuePerRandom / tokenPrice) * 10 ** decimals
          );

          const symbol = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "symbol",
          });

          selectedTokens.push(tokenAddress);
          selectedAmounts.push(BigInt(tokenAmount));
          selectedDetails.push({
            type: "Random",
            symbol,
            address: tokenAddress,
            amount: tokenAmount / 10 ** decimals,
            value: valuePerRandom,
            price: tokenPrice,
            source: priceData.source,
          });

          console.log(
            `   ✅ ${symbol.padEnd(8)} | ${(tokenAmount / 10 ** decimals).toFixed(4).padStart(12)} tokens | ~$${valuePerRandom.toFixed(2).padStart(7)} | $${tokenPrice.toFixed(6)} (${priceData.source})`
          );
        } catch (error) {
          console.warn(
            `   ⚠️  Error processing ${tokenAddress}: ${error.message}`
          );
        }
      }
    }

    // 6. Calculate actual total value
    console.log(`\n${"─".repeat(60)}`);
    console.log(`📊 Final Selection Summary:\n`);

    let actualTotalValue = 0;
    for (const detail of selectedDetails) {
      const tokenValue = detail.amount * detail.price;
      actualTotalValue += tokenValue;
      console.log(
        `   ${detail.type.padEnd(8)} | ${detail.symbol.padEnd(8)} | ${detail.amount.toFixed(4).padStart(12)} | $${tokenValue.toFixed(2).padStart(8)}`
      );
    }

    console.log(`\n${"─".repeat(60)}`);
    console.log(`💰 Total Value: $${actualTotalValue.toFixed(2)}`);
    console.log(`🎯 Target Value: $${targetValueInUSD.toFixed(2)}`);
    const variance =
      ((actualTotalValue - targetValueInUSD) / targetValueInUSD) * 100;
    console.log(
      `📊 Variance: ${variance >= 0 ? "+" : ""}${variance.toFixed(2)}%`
    );

    if (Math.abs(variance) > 5) {
      console.log(`⚠️  Warning: Variance exceeds 5%`);
    } else {
      console.log(`✅ Variance within acceptable range`);
    }

    console.log(`\n📦 Total Tokens Selected: ${selectedTokens.length}`);
    console.log(`${"=".repeat(60)}\n`);

    return {
      tokens: selectedTokens,
      amounts: selectedAmounts,
      details: selectedDetails,
      totalValue: actualTotalValue,
    };
  } catch (error) {
    console.error(`❌ Error in token selection:`, error);
    throw error;
  }
}

// Run tests
(async () => {
  try {
    console.log("\n🧪 Token Selection Algorithm Test Suite\n");

    // Test all tiers
    await testTokenSelection(1, 10); // Tier 1: $10
    await testTokenSelection(2, 100); // Tier 2: $100
    await testTokenSelection(3, 500); // Tier 3: $500
    await testTokenSelection(4, 1000); // Tier 4: $1000

    console.log("✅ All tests completed successfully!\n");
  } catch (error) {
    console.error("❌ Test suite failed:", error);
    process.exit(1);
  }
})();
