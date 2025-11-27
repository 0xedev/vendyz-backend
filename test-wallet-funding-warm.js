/**
 * Test Wallet Funding Flow - Production Simulation (Warm Cache)
 *
 * This simulates production where the price cache is already running
 */

import { createPublicClient, http, formatUnits, parseUnits } from "viem";
import { base } from "viem/chains";
import { generateMnemonic, mnemonicToAccount } from "viem/accounts";
import { english } from "viem/accounts";
import * as dotenv from "dotenv";
import {
  startPriceCache,
  getCachedPrices,
  getCachedToken,
} from "./src/priceCache.js";
import {
  SponsorAunctionAbi,
  SponsorAunctionAddress,
  TokenTreasuryAbi,
  TokenTreasuryAddress,
} from "./src/constant.js";

dotenv.config();

const BASE_RPC_URL = process.env.BASE_RPC_URL;
const SPONSOR_AUCTION_ADDRESS = SponsorAunctionAddress;
const TOKEN_TREASURY_ADDRESS = TokenTreasuryAddress;

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

const ETH_AMOUNT_WEI = 70000000000000n;

console.log("\n🧪 Testing Wallet Funding Process (Production Simulation)");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// Wait for price cache to initialize
console.log("⏳ Initializing price cache (simulating production startup)...");
startPriceCache();

// Wait 8 seconds for cache to populate
await new Promise((resolve) => setTimeout(resolve, 8000));

console.log("✅ Price cache initialized\n");

// Now run the test
const timings = {};

async function testWalletFunding() {
  try {
    // Step 1: Generate wallet
    console.log("📝 Step 1: Generating new wallet...");
    const start1 = Date.now();

    const mnemonic = generateMnemonic(english);
    const account = mnemonicToAccount(mnemonic);

    timings.walletGeneration = Date.now() - start1;
    console.log(`✅ Wallet generated in ${timings.walletGeneration}ms`);
    console.log(`   Address: ${account.address}`);
    console.log(`   Mnemonic: ${mnemonic.substring(0, 30)}...\n`);

    // Step 2: Get prices from cache (should be instant)
    console.log("💰 Step 2: Fetching cached token prices...");
    const start2 = Date.now();

    const priceData = getCachedPrices();

    timings.fetchPrices = Date.now() - start2;
    console.log(`✅ Prices fetched from cache in ${timings.fetchPrices}ms`);
    console.log(`   Total tokens available: ${priceData.tokenCount}`);
    console.log(`   Treasury value: ${priceData.totalValueFormatted}\n`);

    // Step 3: Get active sponsors (blockchain read - slower)
    console.log("🎯 Step 3: Reading active sponsors from blockchain...");
    const start3 = Date.now();

    const activeSponsors = await publicClient.readContract({
      address: SPONSOR_AUCTION_ADDRESS,
      abi: SponsorAunctionAbi,
      functionName: "getActiveSponsors",
    });

    timings.getSponsors = Date.now() - start3;
    console.log(`✅ Active sponsors fetched in ${timings.getSponsors}ms`);
    console.log(`   Sponsor count: ${activeSponsors.length}\n`);

    // Step 4: Select tokens for funding
    console.log("🎲 Step 4: Selecting tokens for $0.3 funding...");
    const start4 = Date.now();

    const targetValue = 0.3; // $0.30 USD
    const selectedTokens = [];
    let currentValue = 0;

    // Always include ETH first
    const ethToken = getCachedToken(
      "0x0000000000000000000000000000000000000000"
    );
    if (ethToken) {
      selectedTokens.push({
        address: "0x0000000000000000000000000000000000000000",
        amount: ETH_AMOUNT_WEI,
        symbol: "ETH",
        value: ethToken.walletValueUSD,
      });
      currentValue += ethToken.walletValueUSD;
      console.log(
        `   + ETH: ${formatUnits(ETH_AMOUNT_WEI, 18)} ($${ethToken.walletValueUSD.toFixed(4)})`
      );
    }

    // Add sponsor tokens to reach target
    console.log(
      `   Remaining to allocate: $${(targetValue - currentValue).toFixed(4)}`
    );

    for (const sponsorAddress of activeSponsors) {
      if (currentValue >= targetValue) break;

      const token = getCachedToken(sponsorAddress);
      if (!token || token.balanceFormatted === 0) continue;

      // Allocate equal portions or whatever is available
      const portionValue = (targetValue - currentValue) / activeSponsors.length;
      const tokensToSend = Math.min(
        token.balanceFormatted,
        portionValue / token.priceUSD
      );

      if (tokensToSend > 0) {
        const tokenValue = tokensToSend * token.priceUSD;
        selectedTokens.push({
          address: sponsorAddress,
          amount: parseUnits(
            tokensToSend.toFixed(token.decimals),
            token.decimals
          ),
          symbol: token.symbol,
          value: tokenValue,
        });
        currentValue += tokenValue;
        console.log(
          `   + ${token.symbol}: ${tokensToSend.toFixed(6)} ($${tokenValue.toFixed(4)})`
        );
      }
    }

    timings.tokenSelection = Date.now() - start4;
    console.log(`✅ Token selection completed in ${timings.tokenSelection}ms`);
    console.log(`   Total value: $${currentValue.toFixed(4)}`);
    console.log(`   Tokens selected: ${selectedTokens.length}\n`);

    // Step 5: Prepare transaction (simulation)
    console.log("📤 Step 5: Preparing funding transaction...");
    const start5 = Date.now();

    const tokenAddresses = selectedTokens
      .filter((t) => t.address !== "0x0000000000000000000000000000000000000000")
      .map((t) => t.address);
    const tokenAmounts = selectedTokens
      .filter((t) => t.address !== "0x0000000000000000000000000000000000000000")
      .map((t) => t.amount);

    console.log("   Transaction details:");
    console.log(`   - Recipient: ${account.address}`);
    console.log(
      `   - ETH amount: ${ETH_AMOUNT_WEI} wei (${formatUnits(ETH_AMOUNT_WEI, 18)} ETH)`
    );
    console.log(`   - Token addresses: ${tokenAddresses.length}`);
    console.log(`   - Token amounts: ${tokenAmounts.length}`);

    timings.prepareTransaction = Date.now() - start5;
    console.log(`✅ Transaction prepared in ${timings.prepareTransaction}ms`);
    console.log(`   ⚠️  Transaction NOT sent (simulation only)\n`);

    // Print summary
    const totalTime = Object.values(timings).reduce((a, b) => a + b, 0);

    console.log("📊 Performance Summary (Production Simulation)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `Step 1 - Wallet Generation:       ${timings.walletGeneration}ms`
    );
    console.log(`Step 2 - Fetch Prices (cache):    ${timings.fetchPrices}ms`);
    console.log(`Step 3 - Get Active Sponsors:     ${timings.getSponsors}ms`);
    console.log(
      `Step 4 - Token Selection:         ${timings.tokenSelection}ms`
    );
    console.log(
      `Step 5 - Prepare Transaction:     ${timings.prepareTransaction}ms`
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `TOTAL TIME:                      ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`
    );
    console.log("\n✅ Test completed successfully!\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    console.error(error.stack);
    process.exit(1);
  }
}

testWalletFunding();
