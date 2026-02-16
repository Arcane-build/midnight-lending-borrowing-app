import "dotenv/config";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import {
  getNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import { nativeToken, Transaction, ZswapSecretKeys, DustSecretKey } from "@midnight-ntwrk/ledger-v6";
import { WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import * as Rx from "rxjs";
import { type WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import chalk from "chalk";
import { MidnightProviders } from "./providers/midnight-providers.js";
import { EnvironmentManager } from "./utils/environment.js";
import { MidnightWalletProvider } from "./midnight-wallet-provider.js";
import { FluentWalletBuilder } from "@midnight-ntwrk/testkit-js";
import { syncWallet, waitForUnshieldedFunds } from "./wallet-utils.js";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v6";
import pino from "pino";

// Fix WebSocket for Node.js environment
// @ts-ignore
globalThis.WebSocket = WebSocket;

async function main() {
  console.log();
  console.log(chalk.blue.bold("━".repeat(60)));
  console.log(chalk.blue.bold("🌙  lending-borowing-app Deployment"));
  console.log(chalk.blue.bold("━".repeat(60)));
  console.log();

  try {
    // Validate environment
    EnvironmentManager.validateEnvironment();

    const networkConfig = EnvironmentManager.getNetworkConfig();
    const contractName = process.env.CONTRACT_NAME || "lending-pool";
    const networkId = process.env.MIDNIGHT_NETWORK || "preview";

    // Check if contract is compiled
    if (!EnvironmentManager.checkContractCompiled(contractName)) {
      console.error("❌ Contract not compiled! Run: npm run compile");
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

    const LendingPoolModule = await import(contractModulePath);
    
    // Create placeholder addresses for constructor (32 bytes each)
    // In production, these would be actual contract addresses
    // For now, using placeholder values - these should be replaced with real addresses
    const adminAddr = Buffer.alloc(32, 0x01);
    const rateModelAddr = Buffer.alloc(32, 0x02);
    const oracleAddr = Buffer.alloc(32, 0x03);
    
    // Owner address for Ownable (typically same as admin or a multisig)
    // Note: Ownable expects Either<ZswapCoinPublicKey, ContractAddress>
    // For now, using a placeholder - in production this would be a real public key
    const ownerAddr = Buffer.alloc(32, 0x01); // Using same as admin for simplicity
    
    // Create contract instance with minimal witness functions for deployment
    // (Constructor doesn't use witnesses, only the initial state)
    const contractInstance = new LendingPoolModule.Contract({
      userSecretKey: async (context: any) => [context.privateState, Buffer.alloc(32)],
      depositAmount: async (context: any) => [context.privateState, 0n],
      withdrawAmount: async (context: any) => [context.privateState, 0n],
      borrowAmount: async (context: any) => [context.privateState, 0n],
      repayAmount: async (context: any) => [context.privateState, 0n],
      currentTimestamp: async (context: any) => {
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        return [context.privateState, timestamp];
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
    console.log(chalk.blue("🚀 Deploying contract (30-60 seconds)..."));
    console.log();
    console.log(chalk.yellow("⚠️  Note: Constructor requires admin, rate model, oracle, and owner addresses."));
    console.log(chalk.yellow("   Using placeholder addresses for deployment..."));
    console.log(chalk.gray(`   Admin: ${Buffer.from(adminAddr).toString("hex")}`));
    console.log(chalk.gray(`   Rate Model: ${Buffer.from(rateModelAddr).toString("hex")}`));
    console.log(chalk.gray(`   Oracle: ${Buffer.from(oracleAddr).toString("hex")}`));
    console.log(chalk.gray(`   Owner: ${Buffer.from(ownerAddr).toString("hex")}`));
    console.log();

    // Deploy contract
    // Note: Constructor arguments need to be provided via initialState
    // The deployContract function will call the contract's initialState method
    // We need to override the contract's initialState to pass constructor args
    // Constructor now requires: adminAddr, rateModelAddr, oracleAddr, owner
    const contractWithInitialState = {
      ...contractInstance,
      initialState: (context: any) => {
        return contractInstance.initialState(context, adminAddr, rateModelAddr, oracleAddr, ownerAddr);
      },
    };

    const deployed = await deployContract(providers, {
      contract: contractWithInitialState as any,
      privateStateId: "lendingPoolState",
      initialPrivateState: {},
    });

    const contractAddress = deployed.deployTxData.public.contractAddress;

    // Save deployment information
    console.log();
    console.log(chalk.green.bold("━".repeat(60)));
    console.log(chalk.green.bold("🎉 CONTRACT DEPLOYED SUCCESSFULLY!"));
    console.log(chalk.green.bold("━".repeat(60)));
    console.log();
    console.log(chalk.cyan.bold("📍 Contract Address:"));
    console.log(chalk.white(`   ${contractAddress}`));
    console.log();

    const info = {
      contractAddress,
      deployedAt: new Date().toISOString(),
      network: networkConfig.name,
      contractName,
    };

    fs.writeFileSync("deployment.json", JSON.stringify(info, null, 2));
    console.log(chalk.gray("✅ Saved to deployment.json"));
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
