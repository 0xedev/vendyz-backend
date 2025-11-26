/**
 * Test CoinGecko Pro API directly
 */

import fetch from "node-fetch";

const COINGECKO_API_KEY = "CG-dWqQuUYppVGZs9SnRkQw6quj";
const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

async function testCoinGecko() {
  const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  // Test 1: Token price endpoint
  console.log("\n📊 Test 1: Token price endpoint (simple/token_price)");
  try {
    const url1 = `${COINGECKO_API_URL}/simple/token_price/base?contract_addresses=${usdcAddress.toLowerCase()}&vs_currencies=usd`;
    console.log("URL:", url1);

    const response1 = await fetch(url1, {
      method: "GET",
      headers: {
        "x-cg-pro-api-key": COINGECKO_API_KEY,
        accept: "application/json",
      },
    });

    console.log("Status:", response1.status, response1.statusText);
    const text1 = await response1.text();
    console.log("Response:", text1);

    if (response1.ok) {
      const data1 = JSON.parse(text1);
      console.log("✅ Parsed data:", JSON.stringify(data1, null, 2));
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }

  // Test 2: Simple price endpoint (without token_price)
  console.log("\n📊 Test 2: Simple price endpoint (simple/price)");
  try {
    const url2 = `${COINGECKO_API_URL}/simple/price?ids=usd-coin&vs_currencies=usd&platforms=base`;
    console.log("URL:", url2);

    const response2 = await fetch(url2, {
      method: "GET",
      headers: {
        "x-cg-pro-api-key": COINGECKO_API_KEY,
        accept: "application/json",
      },
    });

    console.log("Status:", response2.status, response2.statusText);
    const text2 = await response2.text();
    console.log("Response:", text2);

    if (response2.ok) {
      const data2 = JSON.parse(text2);
      console.log("✅ Parsed data:", JSON.stringify(data2, null, 2));
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }

  // Test 3: Coins list to find Base platform
  console.log("\n📊 Test 3: Testing API key validity");
  try {
    const url3 = `${COINGECKO_API_URL}/ping`;
    console.log("URL:", url3);

    const response3 = await fetch(url3, {
      method: "GET",
      headers: {
        "x-cg-pro-api-key": COINGECKO_API_KEY,
        accept: "application/json",
      },
    });

    console.log("Status:", response3.status, response3.statusText);
    const text3 = await response3.text();
    console.log("Response:", text3);
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

testCoinGecko();
