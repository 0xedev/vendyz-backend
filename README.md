# Vendyz Backend Service

Backend service for the Vendyz wallet vending machine. Listens for `WalletReady` events from the VendingMachine contract and automatically funds newly generated wallets with tokens from the TokenTreasury.

## Architecture

```
VendingMachine (Base)
    ↓ emits WalletReady event
Backend Service (this)
    ↓ generates wallet + selects tokens
TokenTreasury (Base)
    ↓ transfers tokens to new wallet
Database (optional)
    ↓ stores encrypted credentials
```

## Setup

1. **Install dependencies:**

   ```bash
   cd backend
   npm install
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Authorize backend address:**

   The backend wallet must be authorized in TokenTreasury before it can fund wallets:

   ```solidity
   // As TokenTreasury owner, call:
   TokenTreasury.authorizeBackend(<BACKEND_ADDRESS>)
   ```

   Get your backend address by running:

   ```bash
   node -e "import('viem/accounts').then(({ privateKeyToAccount }) => console.log(privateKeyToAccount(process.env.BACKEND_PRIVATE_KEY).address))"
   ```

4. **Fund TokenTreasury:**

   Deposit tokens into TokenTreasury so the backend can distribute them:

   ```solidity
   // Approve tokens
   ERC20(token).approve(TokenTreasury, amount);

   // Deposit
   TokenTreasury.depositTokens(token, amount);
   ```

## Running

### Development (with auto-reload):

```bash
npm run dev
```

### Production:

```bash
npm start
```

## Environment Variables

| Variable                  | Description                     | Example                    |
| ------------------------- | ------------------------------- | -------------------------- |
| `BASE_RPC_URL`            | Base mainnet RPC endpoint       | `https://mainnet.base.org` |
| `BACKEND_PRIVATE_KEY`     | Private key for backend wallet  | `0x...`                    |
| `VENDING_MACHINE_ADDRESS` | VendingMachine contract address | `0x12e3...`                |
| `TOKEN_TREASURY_ADDRESS`  | TokenTreasury contract address  | `0x194A...`                |
| `USDC_ADDRESS`            | USDC token address on Base      | `0x8335...`                |

## How It Works

1. **Event Detection:**
   - Service watches VendingMachine for `WalletReady` events
   - Event contains: requestId, buyer, tier, estimatedValue

2. **Wallet Generation:**
   - Generates new HD wallet with BIP39 mnemonic (12 words)
   - Derives address and private key

3. **Token Selection:**
   - Queries SponsorAuction for active sponsor tokens
   - Mixes sponsor tokens with curated random tokens (50/50)
   - Uses Price Oracle (CoinGecko + Moralis) for real-time USD prices
   - Calculates token amounts to match tier's estimatedValue
   - See [TOKEN_SELECTION.md](./TOKEN_SELECTION.md) for detailed algorithm

4. **Funding:**
   - Calls `TokenTreasury.fundWallet(address, tokens[], amounts[], requestId)`
   - TokenTreasury transfers tokens to the new wallet

5. **Storage:**
   - Encrypts private key and mnemonic
   - Stores in database with requestId as lookup key
   - Buyer can retrieve via frontend using their requestId

## Security Considerations

- ✅ Backend private key stored in `.env` (never committed)
- ✅ Backend must be explicitly authorized in TokenTreasury
- ✅ Wallet credentials encrypted before database storage
- ✅ Only authorized backend can call `fundWallet()`
- ⚠️ Keep `.env` secure - backend key has access to TokenTreasury funds
- ⚠️ Use separate backend wallet (not owner wallet)
- ⚠️ Implement rate limiting to prevent abuse

## Components

### Price Oracle

- **Primary**: CoinGecko Demo API
- **Fallback**: Moralis API
- **Cache**: 5-minute in-memory cache
- **Rate Limits**: Built-in to prevent API blocks
- See [PRICE_ORACLE.md](../docs/PRICE_ORACLE.md) for details

### Token Selection Algorithm

- **Treasury-based**: Only uses tokens with balance in TokenTreasury
- **50/50 mix**: Sponsor tokens + Other treasury tokens
- **Real-time pricing**: Uses Price Oracle for accurate amounts
- **Balance checking**: Validates treasury has sufficient tokens before allocation
- **Fallback strategy**: Uses first available treasury token if selection fails
- See [TOKEN_SELECTION.md](./TOKEN_SELECTION.md) for full algorithm

## TODO

- [x] Implement proper token selection algorithm ✅
  - [x] Query TokenTreasury for available token balances
  - [x] Query SponsorAuction for active sponsors
  - [x] Get token prices from CoinGecko/Moralis
  - [x] Calculate amounts to match tier value
  - [x] Mix 50% sponsors, 50% treasury tokens
  - [x] Validate treasury has sufficient balance

- [ ] Add database integration
  - PostgreSQL or MongoDB
  - Encrypt credentials with AES-256
  - Store: requestId, buyer, walletAddress, encryptedPrivateKey, encryptedMnemonic

- [ ] Add retry logic
  - Retry failed funding attempts
  - Exponential backoff
  - Alert on repeated failures

- [ ] Add monitoring
  - Log to cloud service (Datadog, CloudWatch)
  - Alert on errors
  - Track success rate

- [ ] Add API endpoint
  - `/api/wallet/:requestId` - retrieve wallet for buyer
  - Authentication via signature
  - Rate limiting

## Deployment

### Using PM2 (recommended):

```bash
npm install -g pm2
pm2 start src/index.js --name vendyz-backend
pm2 save
pm2 startup
```

### Using Docker:

```bash
docker build -t vendyz-backend .
docker run -d --env-file .env vendyz-backend
```

### Using systemd:

Create `/etc/systemd/system/vendyz-backend.service`:

```ini
[Unit]
Description=Vendyz Backend Service
After=network.target

[Service]
Type=simple
User=vendyz
WorkingDirectory=/opt/vendyz-backend
ExecStart=/usr/bin/node src/index.js
Restart=always
EnvironmentFile=/opt/vendyz-backend/.env

[Install]
WantedBy=multi-user.target
```

## Monitoring

Check logs:

```bash
# PM2
pm2 logs vendyz-backend

# Docker
docker logs <container-id>

# systemd
journalctl -u vendyz-backend -f
```

## Support

For issues or questions, open an issue on GitHub.
