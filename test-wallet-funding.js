/**
 * Test Wallet Funding with Timing
 *
 * Simulates the wallet creation and funding process
 * Target: $0.30 USD worth of tokens
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  generateMnemonic,
  mnemonicToAccount,
  generatePrivateKey,
  privateKeyToAddress,
} from "viem/accounts";
import { english } from "viem/accounts";
import * as dotenv from "dotenv";
import {
  getCachedPrices,
  getCachedToken,
  forceUpdateCache,
} from "./src/priceCache.js";
import {
  TokenTreasuryAbi,
  TokenTreasuryAddress,
  SponsorAunctionAbi,
  SponsorAunctionAddress,
} from "./src/constant.js";

dotenv.config();

// Environment variables
const BASE_RPC_URL = process.env.BASE_RPC_URL;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY;
const TOKEN_TREASURY_ADDRESS = TokenTreasuryAddress;
const SPONSOR_AUCTION_ADDRESS = SponsorAunctionAddress;

// Target funding amount
const TARGET_USD = 0.3;

// Public client for reading blockchain data
const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

// Wallet client for transactions
const backendAccount = privateKeyToAccount(BACKEND_PRIVATE_KEY);
const walletClient = createWalletClient({
  account: backendAccount,
  chain: base,
  transport: http(BASE_RPC_URL),
});

console.log("\n🧪 Testing Wallet Funding Process");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

async function testWalletFunding() {
  const startTime = Date.now();
  let step1Time, step2Time, step3Time, step4Time, step5Time;

  try {
    // Step 1: Generate new wallet
    console.log("📝 Step 1: Generating new wallet...");
    const step1Start = Date.now();

    const mnemonic = generateMnemonic(english);
    const newWallet = mnemonicToAccount(mnemonic);

    step1Time = Date.now() - step1Start;
    console.log(`✅ Wallet generated in ${step1Time}ms`);
    console.log(`   Address: ${newWallet.address}`);
    console.log(`   Mnemonic: ${mnemonic.substring(0, 30)}...`);

    // Step 2: Get cached prices (initialize if needed)
    console.log("\n💰 Step 2: Fetching cached token prices...");
    const step2Start = Date.now();

    let priceCache = getCachedPrices();
    if (!priceCache.tokens || priceCache.tokens.length === 0) {
      console.log("   Price cache empty, initializing...");
      priceCache = await forceUpdateCache();
    }

    step2Time = Date.now() - step2Start;
    console.log(`✅ Prices fetched from cache in ${step2Time}ms`);
    console.log(`   Total tokens available: ${priceCache.tokenCount}`);
    console.log(`   Treasury value: ${priceCache.totalValueFormatted}`);

    // Step 3: Get active sponsors
    console.log("\n🎯 Step 3: Reading active sponsors from blockchain...");
    const step3Start = Date.now();

    const activeSponsors = await publicClient.readContract({
      address: SPONSOR_AUCTION_ADDRESS,
      abi: SponsorAunctionAbi,
      functionName: "getActiveSponsors",
    });

    step3Time = Date.now() - step3Start;
    console.log(`✅ Active sponsors fetched in ${step3Time}ms`);
    console.log(`   Sponsor count: ${activeSponsors.length}`);

    // Step 4: Select tokens to match $0.30 target
    console.log(`\n🎲 Step 4: Selecting tokens for $${TARGET_USD} funding...`);
    const step4Start = Date.now();

    const selectedTokens = [];
    let totalValue = 0;

    // Add ETH first (0.00007 ETH)
    const ethData = priceCache.tokens.find((t) => t.symbol === "ETH");
    if (ethData) {
      selectedTokens.push({
        address: ethData.address,
        symbol: ethData.symbol,
        amount: "70000000000000", // 0.00007 ETH in wei
        amountFormatted: "0.00007",
        value: ethData.walletValueUSD,
      });
      totalValue += ethData.walletValueUSD;
      console.log(`   + ETH: 0.00007 ($${ethData.walletValueUSD.toFixed(4)})`);
    }

    // Add sponsor tokens to reach target
    const remainingValue = TARGET_USD - totalValue;
    console.log(`   Remaining to allocate: $${remainingValue.toFixed(4)}`);

    for (const sponsorAddress of activeSponsors) {
      if (totalValue >= TARGET_USD) break;

      const tokenData = priceCache.tokens.find(
        (t) => t.address.toLowerCase() === sponsorAddress.toLowerCase()
      );

      if (
        !tokenData ||
        tokenData.price === 0 ||
        tokenData.balanceFormatted === 0
      ) {
        continue;
      }

      // Calculate amount needed to fill remaining value
      const valueToAdd = Math.min(remainingValue, tokenData.value);
      const tokenAmount = valueToAdd / tokenData.price;
      const tokenAmountRaw = BigInt(
        Math.floor(tokenAmount * Math.pow(10, tokenData.decimals))
      );

      if (tokenAmountRaw > 0n) {
        selectedTokens.push({
          address: tokenData.address,
          symbol: tokenData.symbol,
          amount: tokenAmountRaw.toString(),
          amountFormatted: tokenAmount.toFixed(6),
          value: valueToAdd,
        });
        totalValue += valueToAdd;
        console.log(
          `   + ${tokenData.symbol}: ${tokenAmount.toFixed(6)} ($${valueToAdd.toFixed(4)})`
        );
      }
    }

    step4Time = Date.now() - step4Start;
    console.log(`✅ Token selection completed in ${step4Time}ms`);
    console.log(`   Total value: $${totalValue.toFixed(4)}`);
    console.log(`   Tokens selected: ${selectedTokens.length}`);

    // Step 5: Simulate funding transaction (we won't actually send it)
    console.log("\n📤 Step 5: Preparing funding transaction...");
    const step5Start = Date.now();

    // Prepare token arrays for fundWallet call
    const tokenAddresses = selectedTokens
      .filter((t) => t.symbol !== "ETH")
      .map((t) => t.address);
    const tokenAmounts = selectedTokens
      .filter((t) => t.symbol !== "ETH")
      .map((t) => BigInt(t.amount));

    // Calculate ETH amount
    const ethAmount =
      selectedTokens.find((t) => t.symbol === "ETH")?.amount || "0";

    console.log("   Transaction details:");
    console.log(`   - Recipient: ${newWallet.address}`);
    console.log(`   - ETH amount: ${ethAmount} wei (0.00007 ETH)`);
    console.log(`   - Token addresses: ${tokenAddresses.length}`);
    console.log(`   - Token amounts: ${tokenAmounts.length}`);

    // Simulate the transaction (don't actually send)
    const txData = {
      address: TOKEN_TREASURY_ADDRESS,
      abi: TokenTreasuryAbi,
      functionName: "fundWallet",
      args: [newWallet.address, tokenAddresses, tokenAmounts],
      value: BigInt(ethAmount),
    };

    step5Time = Date.now() - step5Start;
    console.log(`✅ Transaction prepared in ${step5Time}ms`);
    console.log("   ⚠️  Transaction NOT sent (simulation only)");

    // Summary
    const totalTime = Date.now() - startTime;
    console.log("\n📊 Performance Summary");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `Step 1 - Wallet Generation:    ${step1Time.toString().padStart(6)}ms`
    );
    console.log(
      `Step 2 - Fetch Prices (cache):  ${step2Time.toString().padStart(6)}ms`
    );
    console.log(
      `Step 3 - Get Active Sponsors:   ${step3Time.toString().padStart(6)}ms`
    );
    console.log(
      `Step 4 - Token Selection:       ${step4Time.toString().padStart(6)}ms`
    );
    console.log(
      `Step 5 - Prepare Transaction:   ${step5Time.toString().padStart(6)}ms`
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `TOTAL TIME:                     ${totalTime.toString().padStart(6)}ms (${(totalTime / 1000).toFixed(2)}s)`
    );
    console.log("\n✅ Test completed successfully!\n");
  } catch (error) {
    console.error("\n❌ Error during test:", error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testWalletFunding();
