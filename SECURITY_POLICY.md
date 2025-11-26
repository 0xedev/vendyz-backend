# Wallet Credential Security Policy

## 🔒 5-Minute Auto-Delete Policy

For maximum security, wallet credentials (private keys and mnemonics) are automatically deleted from the database after **5 minutes**.

### Why?

1. **Minimize Attack Surface**: The less time credentials exist in storage, the lower the risk of compromise
2. **User Responsibility**: Users must export their private key immediately after wallet creation
3. **No Long-Term Storage**: We don't store user private keys - they're only kept temporarily for the export flow

### How It Works

1. **Wallet Created**: When a user purchases a wallet, credentials are encrypted and stored in Supabase
2. **User Exports**: User has 5 minutes to view and export their private key via the frontend
3. **Auto-Cleanup**: A background job runs every minute, deleting any wallets older than 5 minutes
4. **Gone Forever**: Once deleted, there's NO WAY to recover the credentials

### Implementation

- **Location**: `backend/src/database.js`
- **Function**: `cleanupOldWallets()` - Deletes wallets where `created_at < NOW() - 5 minutes`
- **Schedule**: Runs every 1 minute via `setInterval`
- **Startup**: Auto-cleanup starts when backend service initializes
- **Shutdown**: Cleanup stops gracefully on service shutdown

### Database Schema

```sql
-- The created_at timestamp is used to track wallet age
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- Used for auto-cleanup
);
```

### Frontend Integration

The frontend should:

1. **Show Warning**: Display a prominent warning that credentials will be deleted after 5 minutes
2. **Countdown Timer**: Show a countdown (5:00, 4:59, 4:58...) to create urgency
3. **Export Immediately**: Encourage users to copy/download their private key right away
4. **No Reload**: Warn that refreshing the page will lose access to the credentials

### Testing Auto-Cleanup

To test the cleanup function:

```bash
# Start the backend
npm run dev

# In another terminal, watch the logs
tail -f backend.log

# You should see cleanup messages every minute:
# 🗑️  Cleaned up 2 wallet(s) older than 5 minutes
#    - Request ID: 123, Buyer: 0x...
```

### Manual Cleanup

To manually trigger cleanup (for testing):

```javascript
import { cleanupOldWallets } from "./src/database.js";

// Run cleanup immediately
await cleanupOldWallets();
```

### Configuration

To change the TTL (Time To Live), modify `cleanupOldWallets()` in `database.js`:

```javascript
// Current: 5 minutes
const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

// Example: Change to 10 minutes
const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
```

### Logging

The cleanup function logs:

- ✅ Number of wallets deleted
- ✅ Request ID and buyer address for each deleted wallet
- ❌ Any errors during cleanup

Example output:

```
🗑️  Cleaned up 3 wallet(s) older than 5 minutes
   - Request ID: 12345, Buyer: 0x1234...
   - Request ID: 12346, Buyer: 0x5678...
   - Request ID: 12347, Buyer: 0x9abc...
```

## 🚨 Important Notes

1. **No Recovery**: Once deleted, credentials cannot be recovered from the database
2. **User Warning**: Frontend MUST warn users about the 5-minute limit
3. **Production Ready**: This policy is designed for production security
4. **Compliance**: Reduces liability by not storing user private keys long-term
