import "dotenv/config";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import {
  getNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v6";
import { WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { MidnightProviders } from "./providers/midnight-providers.js";
import { EnvironmentManager } from "./utils/environment.js";
import { MidnightWalletProvider } from "./midnight-wallet-provider.js";
import { syncWallet, waitForUnshieldedFunds } from "./wallet-utils.js";
import pino from "pino";

// Fix WebSocket for Node.js environment
// @ts-ignore
globalThis.WebSocket = WebSocket;

async function main() {
  console.log();
  console.log(chalk.blue.bold("━".repeat(60)));
  console.log(chalk.blue.bold("🌙  AToken Deployment"));
  console.log(chalk.blue.bold("━".repeat(60)));
  console.log();

  try {
    // Validate environment
    EnvironmentManager.validateEnvironment();

    const networkConfig = EnvironmentManager.getNetworkConfig();
    const contractName = process.env.TOKEN_CONTRACT_NAME || "atoken";
    const networkId = process.env.MIDNIGHT_NETWORK || "preview";

    // Check if contract is compiled
    if (!EnvironmentManager.checkContractCompiled(contractName)) {
      console.error("❌ Contract not compiled! Run: npm run compile:token");
      process.exit(1);
    }

    const walletSeed = process.env.WALLET_SEED!;
    const logger = pino({ level: 'info' });
    const envConfig = EnvironmentManager.getEnvironmentConfiguration();

    // Build wallet from seed using FluentWalletBuilder
    console.log("Building wallet...");
    const walletProvider = await MidnightWalletProvider.build(logger, envConfig, walletSeed);
    await walletProvider.start();

    // Wait for funds
    const unshieldedState = await waitForUnshieldedFunds(
      logger,
      walletProvider.wallet,
      envConfig,
      unshieldedToken(),
      false, // Don't request from faucet automatically
    );

    const balance = (unshieldedState.balances as any)[unshieldedToken().raw] || 0n;
    if (balance === 0n) {
      console.log(chalk.yellow.bold("💰 Balance: ") + chalk.red.bold("0 DUST"));
      console.log();
      console.log(chalk.red.bold("❌ Wallet needs funding to deploy contracts."));
      console.log();
      console.log(chalk.magenta.bold("━".repeat(60)));
      console.log(chalk.magenta.bold("📝 How to Get Test Tokens:"));
      console.log(chalk.magenta.bold("━".repeat(60)));
      console.log();
      console.log(chalk.white("   1. ") + chalk.cyan("Visit: ") + chalk.underline("https://midnight.network/test-faucet"));
      console.log(chalk.white("   2. ") + chalk.cyan("Paste your wallet address"));
      console.log(chalk.white("   3. ") + chalk.cyan("Request tokens from the faucet"));
      console.log();
      console.log(chalk.gray("━".repeat(60)));
      console.log(chalk.gray("⏱️  Faucet transactions can take 2-5 minutes to process."));
      console.log(chalk.gray("━".repeat(60)));
      console.log();
      await walletProvider.stop();
      process.exit(1);
    }

    console.log(chalk.yellow.bold("💰 Balance: ") + chalk.green.bold(`${balance} DUST`));
    console.log();

    // Load compiled contract files
    console.log(chalk.gray("📦 Loading contract..."));
    const contractPath = path.join(process.cwd(), "contracts");
    const contractModulePath = path.join(
      contractPath,
      "managed",
      contractName,
      "contract",
      "index.js"
    );

    const ATokenModule = await import(contractModulePath);
    
    // Get token deployment parameters from environment or use defaults
    const tokenName = process.env.TOKEN_NAME || "aToken";
    const tokenSymbol = process.env.TOKEN_SYMBOL || "aTKN";
    const tokenDecimals = parseInt(process.env.TOKEN_DECIMALS || "18");
    
    // Create placeholder addresses for constructor
    // In production, these would be actual addresses
    const ownerAddr = Buffer.alloc(32, 0x01); // Owner (can pause/unpause)
    const lendingPoolAddr = Buffer.alloc(32, 0x02); // Lending pool (can mint/burn)
    
    // Create contract instance with minimal witness functions for deployment
    const contractInstance = new ATokenModule.Contract({
      userSecretKey: async (context: any) => [context.privateState, Buffer.alloc(32)],
      depositAmount: async (context: any) => [context.privateState, 0n],
      withdrawAmount: async (context: any) => [context.privateState, 0n],
      borrowAmount: async (context: any) => [context.privateState, 0n],
      repayAmount: async (context: any) => [context.privateState, 0n],
      currentTimestamp: async (context: any) => {
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        return [context.privateState, timestamp];
      },
      callerAddress: async (context: any) => {
        // For deployment, return a placeholder
        return [context.privateState, Buffer.alloc(32)];
      },
    });

    // Wallet provider is already built above

    // Configure all required providers
    console.log("Setting up providers...");
    const providers = MidnightProviders.create({
      contractName,
      walletProvider,
      networkConfig,
    });

    // Deploy contract to blockchain
    console.log(chalk.blue("🚀 Deploying AToken contract (30-60 seconds)..."));
    console.log();
    console.log(chalk.yellow("⚠️  Note: Constructor requires name, symbol, decimals, owner, and lending pool addresses."));
    console.log(chalk.yellow("   Using placeholder addresses for deployment..."));
    console.log();
    console.log(chalk.cyan("Token Parameters:"));
    console.log(chalk.gray(`   Name: ${tokenName}`));
    console.log(chalk.gray(`   Symbol: ${tokenSymbol}`));
    console.log(chalk.gray(`   Decimals: ${tokenDecimals}`));
    console.log();
    console.log(chalk.cyan("Addresses:"));
    console.log(chalk.gray(`   Owner: ${Buffer.from(ownerAddr).toString("hex")}`));
    console.log(chalk.gray(`   Lending Pool: ${Buffer.from(lendingPoolAddr).toString("hex")}`));
    console.log();

    // Deploy contract
    // Note: Constructor arguments need to be provided via initialState
    // AToken constructor: _name: Opaque<"string">, _symbol: Opaque<"string">, _decimals: Uint<8>, 
    //                    _owner: Either<ZswapCoinPublicKey, ContractAddress>, 
    //                    _lendingPool: Either<ZswapCoinPublicKey, ContractAddress>
    // In TypeScript, strings are automatically converted to Opaque<"string"> by the runtime
    const contractWithInitialState = {
      ...contractInstance,
      initialState: (context: any) => {
        // Strings are automatically converted to Opaque<"string"> by the Compact runtime
        // ownerAddr and lendingPoolAddr are Uint8Array (32 bytes) which represent addresses
        return contractInstance.initialState(
          context,
          tokenName,  // Will be converted to Opaque<"string">
          tokenSymbol, // Will be converted to Opaque<"string">
          tokenDecimals,
          ownerAddr,  // Either<ZswapCoinPublicKey, ContractAddress>
          lendingPoolAddr // Either<ZswapCoinPublicKey, ContractAddress>
        );
      },
    };

    const deployed = await deployContract(providers, {
      contract: contractWithInitialState as any,
      privateStateId: "atokenState",
      initialPrivateState: {},
    });

    const contractAddress = deployed.deployTxData.public.contractAddress;

    // Save deployment information
    console.log();
    console.log(chalk.green.bold("━".repeat(60)));
    console.log(chalk.green.bold("🎉 AToken CONTRACT DEPLOYED SUCCESSFULLY!"));
    console.log(chalk.green.bold("━".repeat(60)));
    console.log();
    console.log(chalk.cyan.bold("📍 Contract Address:"));
    console.log(chalk.white(`   ${contractAddress}`));
    console.log();
    console.log(chalk.cyan.bold("📋 Token Details:"));
    console.log(chalk.white(`   Name: ${tokenName}`));
    console.log(chalk.white(`   Symbol: ${tokenSymbol}`));
    console.log(chalk.white(`   Decimals: ${tokenDecimals}`));
    console.log();

    const info = {
      contractAddress,
      deployedAt: new Date().toISOString(),
      network: networkConfig.name,
      contractName,
      tokenName,
      tokenSymbol,
      tokenDecimals,
      owner: Buffer.from(ownerAddr).toString("hex"),
      lendingPool: Buffer.from(lendingPoolAddr).toString("hex"),
    };

    fs.writeFileSync("token-deployment.json", JSON.stringify(info, null, 2));
    console.log(chalk.gray("✅ Saved to token-deployment.json"));
    console.log();

    // Stop wallet provider
    await walletProvider.stop();
  } catch (error) {
    console.log();
    console.log(chalk.red.bold("❌ Deployment Failed:"));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    console.log();
    process.exit(1);
  }
}

main().catch(console.error);

