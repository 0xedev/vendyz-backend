# Token Selection Algorithm

The Vendyz backend service implements a sophisticated token selection algorithm that distributes a mix of sponsor and curated tokens to wallet buyers based on real-time price data.

## Overview

When a user purchases a wallet, the backend:

1. Listens for the `WalletReady` event from VendingMachine
2. Generates a new wallet with BIP39 mnemonic
3. **Selects tokens** using the algorithm described below
4. Funds the wallet via TokenTreasury
5. Stores encrypted credentials

## Token Selection Strategy

### Treasury-Based Selection

**All tokens are sourced from the TokenTreasury contract** - no external or random tokens are used. The algorithm only distributes tokens that are already deposited in the treasury.

### 50/50 Mix

- **50% Sponsor Tokens**: From active sponsors in SponsorAuction (that exist in treasury)
- **50% Other Treasury Tokens**: From non-sponsor tokens available in treasury

### Sponsor Tokens

Sponsor tokens are fetched from the `SponsorAuction.getActiveSponsors()` function. These are tokens from projects that have won auction spots by placing the highest bids.

**Requirements**:

- Must be in the active sponsors list
- Must have non-zero balance in TokenTreasury
- Price must be available from Price Oracle

**Distribution**: Equal value distribution among all active sponsors with treasury balance

- If 2 sponsors are active and sponsor allocation is $50, each gets $25 worth
- If sponsor has insufficient treasury balance, uses all available balance

### Other Treasury Tokens

Other tokens are selected from non-sponsor tokens that have balance in the TokenTreasury.

**Token Discovery**: The system checks common Base tokens for treasury balance:

- USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
- DEGEN (0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed)
- WETH (0x4200000000000000000000000000000000000006)
- DAI (0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb)
- cbETH (0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22)
- USDbC (0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA)
- AERO (0x940181a94A35A4569E4529A3CDfB74e38FD98631)

**Distribution**: Equal value distribution among selected treasury tokens (max 3)

- Tokens are shuffled and randomly selected each time
- If 3 tokens selected and allocation is $50, each gets ~$16.67 worth
- If token has insufficient treasury balance, uses all available balance

## Price-Based Amount Calculation

The algorithm uses the **Price Oracle** (CoinGecko + Moralis fallback) to:

1. Fetch real-time USD prices for all selected tokens
2. Calculate token amounts based on USD value allocation
3. Account for different token decimals

### Calculation Formula

```javascript
tokenAmount = ((targetValueInUSD / tokenPriceInUSD) * 10) ^ decimals;
```

### Example

For a **Tier 2 wallet** ($100 value):

- **Sponsor allocation**: $50
  - 2 active sponsors: DEGEN and SHIB
  - DEGEN price: $0.0013, decimals: 18
  - DEGEN amount: ($25 / $0.0013) \* 10^18 = 19,230,769,230,769,230,769 (19.23B DEGEN)
  - SHIB price: $0.000015, decimals: 18
  - SHIB amount: ($25 / $0.000015) \* 10^18 = 1,666,666,666,666,666,666,667 (1.67T SHIB)

- **Random allocation**: $50
  - 3 random tokens selected: USDC, WETH, DAI
  - USDC: ($16.67 / $1.00) \* 10^6 = 16,670,000 (16.67 USDC)
  - WETH: ($16.67 / $2,832.97) \* 10^18 = 5,882,352,941,176,471 (0.0059 WETH)
  - DAI: ($16.67 / $0.999) \* 10^18 = 16,686,686,686,686,686,687 (16.69 DAI)

**Total**: 5 tokens worth ~$100

## Error Handling & Fallbacks

### Price Unavailable

If a token's price cannot be fetched:

- Token is skipped
- Value is redistributed to other tokens
- Warning logged to console

### No Treasury Tokens

If no tokens found in TokenTreasury:

- Process fails with error
- Treasury must be funded before service can operate

### No Sponsors

If no sponsors are active OR sponsors have no treasury balance:

- 100% allocation to other treasury tokens
- Warning logged about missing sponsor tokens

### Insufficient Treasury Balance

If a token doesn't have enough balance for calculated amount:

- Uses all available balance for that token
- Logs warning with requested vs available amounts
- Continues with other tokens

### Token Selection Fails

If entire selection process fails:

- **Fallback**: Uses first available token in treasury
- Amount = minimum of requested or available balance
- Error logged

### Sponsor Fetch Fails

If `getActiveSponsors()` call fails:

- Treat as 0 sponsors
- Continue with 100% treasury token allocation
- Warning logged

## Price Oracle Integration

### Data Sources

1. **Primary**: CoinGecko Demo API
   - Base token prices endpoint
   - 5-minute cache
   - Rate limit: 1.2s between calls

2. **Fallback**: Moralis API
   - Token price by contract address
   - Chain: Base (chain ID 8453)
   - Rate limit: 0.5s between calls

### Cache Strategy

- **TTL**: 5 minutes (300 seconds)
- **Storage**: In-memory Map
- **Benefits**: Reduces API calls, faster response, avoids rate limits

## Algorithm Flow

```
1. Receive WalletReady event
   ├─ requestId: 123
   ├─ buyer: 0xABC...
   ├─ tier: 2
   └─ estimatedValue: 100000000 (100 USDC in 6 decimals)

2. Check TokenTreasury balances
   ├─ Query getTokenBalance() for known tokens
   ├─ Filter tokens with balance > 0
   └─ Result: [USDC, DEGEN, WETH, DAI] with balances and decimals

3. Fetch active sponsors from SponsorAuction
   ├─ Success: [0xDEGEN, 0xWETH]
   └─ Failure: [] (empty array)

4. Categorize treasury tokens
   ├─ Sponsor tokens in treasury: [DEGEN, WETH]
   └─ Non-sponsor tokens in treasury: [USDC, DAI]

5. Calculate allocations
   ├─ targetValue: $100
   ├─ sponsorValue: $50 (50%)
   └─ otherValue: $50 (50%)

6. Process sponsor tokens
   └─ For each sponsor in treasury:
      ├─ Fetch token price via Price Oracle
      ├─ Calculate amount: (value/price) * 10^decimals
      ├─ Check treasury balance
      ├─ If insufficient: use all available
      └─ Add to selection

7. Process non-sponsor treasury tokens
   ├─ Shuffle treasury tokens list
   ├─ Select up to 3 tokens (excluding sponsors)
   └─ For each selected token:
      ├─ Fetch token price via Price Oracle
      ├─ Calculate amount: (value/price) * 10^decimals
      ├─ Check treasury balance
      ├─ If insufficient: use all available
      └─ Add to selection

8. Validate total value
   ├─ Call calculateWalletValue() with selected tokens
   ├─ Compare actual value to target value
   └─ Log discrepancy if > 5%

9. Return selection
   ├─ tokens: [address1, address2, ...]
   └─ amounts: [amount1, amount2, ...]

10. Fund wallet via TokenTreasury
    └─ TokenTreasury.fundWallet(walletAddress, tokens, amounts, requestId)
```

## Configuration

### Environment Variables

```bash
# Required
SPONSOR_AUCTION_ADDRESS=0xf4b0943587Ac61Be0Eaed8Ed0fCd45505F72c049

# Optional (defaults shown)
SPONSOR_TOKEN_PERCENTAGE=50  # 50% sponsors, 50% random
```

### Treasury Token Discovery

The system checks for balance in these tokens. To add more tokens, update `getAvailableTokensInTreasury()` in `index.js`:

```javascript
const tokensToCheck = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
  "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DEGEN
  "0x4200000000000000000000000000000000000006", // WETH
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
  "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // cbETH
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
  "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
  // Add more tokens here...
];
```

**Important**: Only tokens with balance in TokenTreasury will be used for wallet funding.

## Monitoring & Logging

The algorithm provides detailed console logs:

```
🎯 Selecting tokens for tier 2...
💰 Target value: $100 USDC
📢 Active sponsors: 2
  ✅ Sponsor: DEGEN - 19230769230769230769 tokens (~$25.00)
  ✅ Sponsor: SHIB - 1666666666666666666667 tokens (~$25.00)
  ✅ Random: USDC - 16.67 tokens (~$16.67)
  ✅ Random: WETH - 0.0059 tokens (~$16.67)
  ✅ Random: DAI - 16.69 tokens (~$16.67)
💰 Total value: $100.01 (target: $100.00)
📦 Selected 5 tokens
```

## Performance Considerations

### Optimization Strategies

1. **Parallel Price Fetching**: Batch CoinGecko requests for multiple tokens
2. **Caching**: 5-minute TTL reduces redundant API calls
3. **Rate Limiting**: Built into price oracle to avoid API blocks
4. **Token Decimals Cache**: Consider caching decimals (immutable)

### Latency Targets

- Token selection: < 3 seconds (with warm cache)
- Token selection: < 10 seconds (cold cache)
- Price oracle hit: < 1ms (cached)
- Price oracle hit: < 500ms (CoinGecko)
- Price oracle hit: < 700ms (Moralis fallback)

## Testing

### Test Token Selection

```bash
# Set up test environment
cp .env.example .env
# Edit .env with your BACKEND_PRIVATE_KEY

# Run setup check (validates configuration)
npm run setup

# Start service in dry-run mode (doesn't actually fund)
npm run dev

# Trigger test WalletReady event from frontend
# Or use Hardhat/Foundry to emit event
```

### Manual Testing

```javascript
import { selectTokensForTier } from "./src/index.js";

// Test Tier 2 ($100)
const result = await selectTokensForTier(2, 100000000n);
console.log("Tokens:", result.tokens);
console.log("Amounts:", result.amounts);
```

## Future Enhancements

### Dynamic Mix Ratio

Instead of fixed 50/50, use formula based on:

- Sponsor bid amounts (higher bids = higher allocation)
- Tier level (higher tiers = more random variety)
- User preferences (let users choose sponsor % at purchase)

### Smart Allocation

- Factor in token volatility (more stable tokens = higher allocation)
- Consider liquidity (only select tokens with sufficient liquidity)
- Historical price stability (prefer tokens with low slippage)

### Token Popularity

- Track which tokens users claim most often
- Adjust random token weights based on popularity
- Remove unpopular tokens from curated list

### Multi-Chain Support

- Extend to other chains (Optimism, Arbitrum, Polygon)
- Bridge tokens if needed
- Chain-specific curated lists

## Security Considerations

### Token Validation

- Only select tokens from trusted sources (sponsors + curated list)
- Validate token contract addresses
- Check for token honeypots/scams before adding to curated list

### Amount Validation

- Ensure calculated amounts don't overflow
- Verify TokenTreasury has sufficient balance before funding
- Implement maximum token amount limits

### Price Manipulation

- Use multiple price sources (already implemented)
- Consider TWAP (Time-Weighted Average Price) for large wallets
- Alert on extreme price discrepancies between sources

## Support

For issues or questions:

- Check logs for detailed error messages
- Run `npm run setup` to validate configuration
- Review price oracle status: `npm run test:oracle`
- Contact: [support@vendyz.xyz](mailto:support@vendyz.xyz)
