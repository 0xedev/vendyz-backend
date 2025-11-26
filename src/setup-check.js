/**
 * Setup script - checks configuration and authorization status
 */

import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";

dotenv.config();

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY;
const TOKEN_TREASURY_ADDRESS = process.env.TOKEN_TREASURY_ADDRESS;
const SPONSOR_AUCTION_ADDRESS = process.env.SPONSOR_AUCTION_ADDRESS;
const USDC_ADDRESS = process.env.USDC_ADDRESS;

if (!BACKEND_PRIVATE_KEY) {
  console.error("❌ BACKEND_PRIVATE_KEY not set");
  process.exit(1);
}

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

const account = privateKeyToAccount(BACKEND_PRIVATE_KEY);

console.log("\n🔍 Vendyz Backend - Setup Check\n");
console.log("━".repeat(50));

// Check 1: Backend address
console.log("\n1️⃣  Backend Address:");
console.log(`   ${account.address}`);

// Check 2: Backend ETH balance
const balance = await publicClient.getBalance({ address: account.address });
console.log(`\n2️⃣  ETH Balance: ${Number(balance) / 1e18} ETH`);
if (balance < 10000000000000000n) {
  // 0.01 ETH
  console.log("   ⚠️  Low balance! Fund backend wallet with ETH for gas");
}

// Check 3: Authorization status
const tokenTreasuryAbi = parseAbi([
  "function isAuthorizedBackend(address backend) view returns (bool)",
  "function owner() view returns (address)",
]);

const isAuthorized = await publicClient.readContract({
  address: TOKEN_TREASURY_ADDRESS,
  abi: tokenTreasuryAbi,
  functionName: "isAuthorizedBackend",
  args: [account.address],
});

console.log(
  `\n3️⃣  TokenTreasury Authorization: ${isAuthorized ? "✅ Authorized" : "❌ Not Authorized"}`
);

if (!isAuthorized) {
  const owner = await publicClient.readContract({
    address: TOKEN_TREASURY_ADDRESS,
    abi: tokenTreasuryAbi,
    functionName: "owner",
  });

  console.log(`\n   ⚠️  Backend not authorized!`);
  console.log(`   📝 To authorize, run as TokenTreasury owner (${owner}):`);
  console.log(`   \n   TokenTreasury.authorizeBackend("${account.address}")`);
}

// Check 4: TokenTreasury token balances
const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const tokensToCheck = [
  USDC_ADDRESS,
  "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DEGEN
  "0x4200000000000000000000000000000000000006", // WETH
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
  "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // cbETH
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
  "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
];

console.log("\n4️⃣  TokenTreasury Balances:");
let hasTokens = false;

for (const tokenAddress of tokensToCheck) {
  try {
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [TOKEN_TREASURY_ADDRESS],
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

      const formattedBalance = Number(balance) / 10 ** decimals;
      console.log(`   ✅ ${symbol}: ${formattedBalance.toFixed(4)} tokens`);
      hasTokens = true;
    }
  } catch (error) {
    // Skip tokens that fail
    continue;
  }
}

if (!hasTokens) {
  console.log("   ⚠️  No tokens found! Deposit tokens into TokenTreasury");
  console.log("   💡 Use TokenTreasury.depositTokens(token, amount)");
}

// Check 5: SponsorAuction active sponsors
const sponsorAuctionAbi = parseAbi([
  "function getActiveSponsors() view returns (address[] memory)",
]);

try {
  const activeSponsors = await publicClient.readContract({
    address: SPONSOR_AUCTION_ADDRESS,
    abi: sponsorAuctionAbi,
    functionName: "getActiveSponsors",
  });

  console.log(
    `\n5️⃣  Active Sponsors: ${activeSponsors.length} token${activeSponsors.length !== 1 ? "s" : ""}`
  );

  if (activeSponsors.length > 0) {
    console.log("   Sponsor tokens:");
    for (const sponsor of activeSponsors) {
      console.log(`   - ${sponsor}`);
    }
  }
} catch (error) {
  console.log(`\n5️⃣  Active Sponsors: ⚠️  Could not fetch (${error.message})`);
}

// Summary
console.log("\n" + "━".repeat(50));
if (isAuthorized && balance > 10000000000000000n && hasTokens) {
  console.log("✅ Setup complete! Ready to start service with: npm start");
} else {
  console.log("⚠️  Setup incomplete. Please address the issues above.");
  if (!isAuthorized) {
    console.log("   - Backend not authorized in TokenTreasury");
  }
  if (balance < 10000000000000000n) {
    console.log("   - Backend wallet needs more ETH for gas");
  }
  if (!hasTokens) {
    console.log("   - TokenTreasury has no token deposits");
  }
}
console.log("");
