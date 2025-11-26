# Vendyz Backend - Testing Guide

## Prerequisites

### 1. Install PostgreSQL

```bash
# macOS
brew install postgresql@15
brew services start postgresql@15

# Or using Docker
docker run --name vendyz-postgres -e POSTGRES_PASSWORD=password -p 5432:5432 -d postgres:15
```

### 2. Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database and user
CREATE DATABASE vendyz;
CREATE USER vendyz_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE vendyz TO vendyz_user;
\q
```

### 3. Generate Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Environment Setup

1. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

2. Update the following variables in `.env`:

```bash
# Database
DATABASE_URL=postgresql://vendyz_user:your_password@localhost:5432/vendyz
ENCRYPTION_KEY=<output_from_step_3>

# API
API_PORT=3001
FRONTEND_URL=http://localhost:3000

# Blockchain (use your actual values)
BACKEND_PRIVATE_KEY=<your_private_key>
VENDING_MACHINE_ADDRESS=0x12e3390140A4fb3424493F039aE695AA2d7AaE9a
TOKEN_TREASURY_ADDRESS=0x194A3440A2E11b8eDBCf69d7f14304cA92a75513
```

## Installation

```bash
cd backend
npm install
```

## Testing

### 1. Test Database Connection

```bash
node -e "
import('pg').then(({ default: pg }) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  client.connect()
    .then(() => console.log('✅ Database connected'))
    .catch(err => console.error('❌ Connection failed:', err))
    .finally(() => client.end());
});
"
```

### 2. Test Price Oracle

```bash
npm run test:oracle
```

### 3. Test Token Selection

```bash
npm run test:selection
```

### 4. Test Complete Backend

```bash
# Start the backend service
npm run dev

# In another terminal, watch logs
tail -f backend.log

# Simulate a WalletReady event from the frontend
```

## API Testing

### Start API Server

```bash
npm start
```

### Test Endpoints

#### Health Check

```bash
curl http://localhost:3001/health
```

#### Get Platform Stats

```bash
curl http://localhost:3001/api/stats
```

#### List Wallets for Buyer

```bash
curl http://localhost:3001/api/wallets/0xYourBuyerAddress
```

#### Retrieve Wallet Credentials

```bash
# Generate signature using ethers.js or viem
# Message: "Retrieve wallet for request {requestId}"

curl -X POST http://localhost:3001/api/wallet/{requestId} \
  -H "Content-Type: application/json" \
  -d '{
    "buyerAddress": "0xYourAddress",
    "signature": "0xYourSignature"
  }'
```

## Production Deployment

### Using PM2

1. Install PM2 globally:

```bash
npm install -g pm2
```

2. Start the service:

```bash
npm run pm2:start
```

3. Monitor logs:

```bash
npm run pm2:logs
```

4. Monitor performance:

```bash
npm run pm2:monit
```

5. Restart service:

```bash
npm run pm2:restart
```

6. Stop service:

```bash
npm run pm2:stop
```

### PM2 Setup for Auto-restart on Reboot

```bash
pm2 startup
pm2 save
```

## Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running: `brew services list` or `docker ps`
- Check DATABASE_URL format: `postgresql://user:pass@host:port/database`
- Verify user has permissions: `psql -U vendyz_user -d vendyz -c '\dt'`

### API Issues

- Check port is not in use: `lsof -i :3001`
- Verify FRONTEND_URL matches your frontend origin
- Check logs for signature verification errors

### Event Listener Issues

- Verify contract addresses are correct
- Check backend wallet has ETH for gas
- Verify backend wallet is authorized in TokenTreasury
- Check RPC endpoint is responding: `curl $BASE_RPC_URL -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`

## Security Notes

1. **Never commit `.env` file** - contains sensitive keys
2. **Encryption key** - Must be 64 hex characters (32 bytes)
3. **Backend private key** - Must be authorized in TokenTreasury contract
4. **API rate limiting** - Configured for 100 req/15min (general), 10 req/min (wallet retrieval)
5. **Signature verification** - Required for wallet credential retrieval

## Database Schema

The `wallets` table structure:

```sql
CREATE TABLE wallets (
  id SERIAL PRIMARY KEY,
  request_id BIGINT UNIQUE NOT NULL,
  buyer_address VARCHAR(42) NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  encrypted_mnemonic TEXT NOT NULL,
  iv VARCHAR(32) NOT NULL,
  auth_tag VARCHAR(32) NOT NULL,
  tier INTEGER NOT NULL,
  estimated_value NUMERIC(20, 6) NOT NULL,
  actual_value NUMERIC(20, 6),
  tokens JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallets_request_id ON wallets(request_id);
CREATE INDEX idx_wallets_buyer ON wallets(buyer_address);
```
