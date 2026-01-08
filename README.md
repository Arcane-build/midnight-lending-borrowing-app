# lending-borowing-app

A Midnight Network application created with `create-mn-app`.

## Getting Started

### Prerequisites

- Node.js 22+ installed
- Docker installed (for proof server)

### Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Setup and deploy**:

   ```bash
   npm run setup
   ```

   This will:

   - Compile your Compact contract
   - Build TypeScript to JavaScript
   - Deploy contract to the testnet

3. **Interact with your contract**:
   ```bash
   npm run cli
   ```

### Available Scripts

**Lending Pool:**
- `npm run compile` - Compile lending pool contract
- `npm run deploy` - Deploy lending pool to testnet

**AToken:**
- `npm run compile:token` - Compile AToken contract
- `npm run deploy:token` - Deploy AToken to testnet

**General:**
- `npm run setup` - Compile, build, and deploy lending pool
- `npm run compile:all` - Compile all contracts (pool + token)
- `npm run build` - Build TypeScript
- `npm run cli` - Interactive CLI for lending pool
- `npm run check-balance` - Check wallet balance
- `npm run reset` - Reset all compiled/built files
- `npm run reset:all` - Reset all files including token deployments
- `npm run clean` - Clean build artifacts
- `npm run validate:all` - Validate TypeScript and compile all contracts

### Environment Variables

Copy `.env.example` to `.env` and configure:

**Required:**
- `WALLET_SEED` - Your 64-character wallet seed (auto-generated)
- `MIDNIGHT_NETWORK` - Network to use (testnet, default: testnet)
- `PROOF_SERVER_URL` - Proof server URL (default: http://127.0.0.1:6300)

**Optional:**
- `CONTRACT_NAME` - Lending pool contract name (default: lending-pool)
- `TOKEN_CONTRACT_NAME` - AToken contract name (default: atoken)
- `TOKEN_NAME` - Token name for deployment (default: aToken)
- `TOKEN_SYMBOL` - Token symbol for deployment (default: aTKN)
- `TOKEN_DECIMALS` - Token decimals (default: 18)

### Getting Testnet Tokens

1. Run `npm run deploy` to see your wallet address
2. Visit [https://midnight.network/test-faucet](https://midnight.network/test-faucet)
3. Enter your address to receive test tokens

### Learn More

- [Midnight Documentation](https://docs.midnight.network)
- [Compact Language Guide](https://docs.midnight.network/compact)
- [Tutorial Series](https://docs.midnight.network/tutorials)
