# Treasury-Based Token Selection - Update Summary

## Changes Made

The token selection algorithm has been updated to **only use tokens that exist in the TokenTreasury contract**, rather than selecting from a predefined curated list.

### Key Changes

#### 1. New Function: `getAvailableTokensInTreasury()`

**Location**: `backend/src/index.js`

Queries TokenTreasury for balance of known tokens and returns only those with non-zero balance:

```javascript
async function getAvailableTokensInTreasury() {
  const tokensToCheck = [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
    "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DEGEN
    "0x4200000000000000000000000000000000000006", // WETH
    "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
    "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // cbETH
    "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
    "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
  ];

  // Returns: [{ address, balance, decimals, symbol }, ...]
}
```

#### 2. Updated `selectTokensForTier()`

**Location**: `backend/src/index.js`

**Before**: Selected from curated list regardless of treasury balance
**After**: Only selects tokens that exist in treasury

**New Flow**:

1. Check TokenTreasury balances for all known tokens
2. Filter tokens with balance > 0
3. Fetch active sponsors
4. Categorize: sponsor tokens in treasury vs non-sponsor tokens in treasury
5. Allocate 50% to sponsors, 50% to other treasury tokens
6. Validate treasury has sufficient balance for each token
7. If insufficient: use all available balance and log warning

**Balance Checking**:

```javascript
if (BigInt(tokenAmount) > token.balance) {
  // Use all available balance instead of calculated amount
  selectedTokens.push(token.address);
  selectedAmounts.push(token.balance);
  console.log(`[ALL AVAILABLE]`);
}
```

#### 3. Updated Setup Check Script

**Location**: `backend/src/setup-check.js`

**Before**: Only showed USDC balance
**After**: Shows all tokens with balance in treasury

**Output Example**:

```
4️⃣  TokenTreasury Balances:
   ✅ USDC: 10000.0000 tokens
   ✅ DEGEN: 50000000.0000 tokens
   ✅ WETH: 5.5000 tokens
   ✅ DAI: 2000.0000 tokens
```

#### 4. Updated Test Script

**Location**: `backend/src/test-token-selection.js`

Now includes treasury balance checking before testing token selection.

#### 5. Updated Documentation

**Location**: `backend/TOKEN_SELECTION.md`, `backend/README.md`

- Removed references to "random tokens" or "curated list"
- Updated to emphasize "treasury tokens"
- Added balance checking information
- Updated algorithm flow diagrams

---

## Important Requirements

### Before Running the Service

The TokenTreasury **must** be funded with tokens before the backend service can operate:

```solidity
// For each token you want to distribute:

// 1. Approve TokenTreasury
ERC20(tokenAddress).approve(TokenTreasury, amount);

// 2. Deposit into treasury
TokenTreasury.depositTokens(tokenAddress, amount);
```

### Recommended Initial Deposits

For production, deposit these amounts:

- **USDC**: $10,000+ (10,000 USDC)
- **DEGEN**: $1,000+ worth
- **WETH**: $5,000+ worth
- **DAI**: $2,000+ worth
- **Other tokens**: Based on expected demand

### Checking Treasury Status

Run the setup check to see current treasury balances:

```bash
cd backend
npm run setup
```

---

## Algorithm Behavior

### Scenario 1: Sufficient Treasury Balance

**Sponsor tokens**: 2 (DEGEN, WETH)  
**Other tokens**: 2 (USDC, DAI)  
**Target value**: $100

Result:

- DEGEN: $25 worth
- WETH: $25 worth
- USDC: $25 worth
- DAI: $25 worth

### Scenario 2: Insufficient Sponsor Balance

**Sponsor tokens**: 1 (DEGEN) - only $10 worth available  
**Other tokens**: 2 (USDC, WETH)  
**Target value**: $100

Result:

- DEGEN: All $10 available ⚠️
- USDC: $45 worth (compensates for shortage)
- WETH: $45 worth

### Scenario 3: No Sponsors

**Sponsor tokens**: 0  
**Other tokens**: 3 (USDC, WETH, DAI)  
**Target value**: $100

Result:

- USDC: $33.33 worth
- WETH: $33.33 worth
- DAI: $33.33 worth

### Scenario 4: Empty Treasury

**All tokens**: 0 balance

Result:

- ❌ Error: "No tokens available in TokenTreasury"
- Service cannot fund wallets

---

## Benefits of Treasury-Based Selection

1. **Real Balance Awareness**: Never tries to distribute tokens that don't exist
2. **Graceful Degradation**: Uses all available balance if insufficient
3. **No External Dependencies**: Doesn't rely on external token lists
4. **Easier Monitoring**: Treasury balances visible on-chain
5. **Better Control**: Owner explicitly controls which tokens are distributed
6. **Audit Trail**: All token movements through treasury contract

---

## Migration from Old System

### Old Approach

```javascript
// Hardcoded list
const CURATED_TOKENS = ["0x...", "0x...", ...];

// Selected blindly without checking treasury
selectedTokens = shuffle(CURATED_TOKENS).slice(0, 3);
```

### New Approach

```javascript
// Query treasury first
const availableTokens = await getAvailableTokensInTreasury();

// Only use what exists
selectedTokens = availableTokens.filter(...);
```

---

## Testing

### Test Token Selection

```bash
npm run test:selection
```

This will:

1. Check treasury balances
2. Fetch active sponsors
3. Run selection algorithm for all tiers
4. Display allocated amounts
5. Validate total value vs target

### Expected Output

```
📦 Checking TokenTreasury balances...
   ✅ USDC: 10000.0000 tokens
   ✅ DEGEN: 50000000.0000 tokens
   ✅ WETH: 5.5000 tokens

✅ Found 3 tokens with balance in treasury

📢 Active Sponsors: 1
   - DEGEN (0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed)

💼 Sponsor tokens in treasury: 1
🎲 Non-sponsor tokens in treasury: 2

📊 Processing Sponsor Tokens:
   ✅ DEGEN     |   38461.5385 tokens | ~$ 50.00 | $0.001300 (coingecko)

📊 Processing Non-Sponsor Treasury Tokens:
   ✅ USDC      |      25.0000 tokens | ~$ 25.00 | $1.000000 (coingecko)
   ✅ WETH      |       0.0088 tokens | ~$ 25.00 | $2832.970000 (coingecko)

💰 Total value: $100.00 (target: $100.00)
✅ Variance within acceptable range
```

---

## Monitoring

### Key Metrics to Track

1. **Treasury Balance**: Monitor total USD value in treasury
2. **Token Distribution**: Track which tokens are being distributed most
3. **Balance Depletion Rate**: How quickly each token is being used
4. **Insufficient Balance Warnings**: Count of warnings in logs
5. **Sponsor Token Usage**: % of wallets that received sponsor tokens

### Log Monitoring

Watch for these warning messages:

```
⚠️  Insufficient balance for DEGEN: need 1000000, have 500000
⚠️  No tokens found! Deposit tokens into TokenTreasury
⚠️  Sponsors exist but none have balance in treasury
```

### Alerts to Configure

- Treasury balance drops below $1,000
- Any token balance drops below 7-day average usage
- 3+ consecutive insufficient balance warnings
- No tokens available in treasury

---

## Next Steps

1. **Fund Treasury**: Deposit tokens into TokenTreasury contract
2. **Verify Setup**: Run `npm run setup` to check balances
3. **Test Algorithm**: Run `npm run test:selection` to validate
4. **Start Service**: Run `npm start` to begin listening for events
5. **Monitor Logs**: Watch for warnings about insufficient balances
6. **Refill As Needed**: Deposit more tokens when balances run low

---

## Support

For issues:

- Check treasury balances: `npm run setup`
- Test algorithm: `npm run test:selection`
- Review logs for warnings
- Verify token deposits on-chain
