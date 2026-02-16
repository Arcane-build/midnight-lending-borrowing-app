import "dotenv/config";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v6";
import { WebSocket } from "ws";
import * as Rx from "rxjs";
import chalk from "chalk";
import { EnvironmentManager } from "./utils/environment.js";
import { MidnightWalletProvider } from "./midnight-wallet-provider.js";
import { waitForUnshieldedFunds, getInitialShieldedState } from "./wallet-utils.js";
import pino from "pino";

// Fix WebSocket for Node.js environment
// @ts-ignore
globalThis.WebSocket = WebSocket;

async function checkBalance() {
  const providersToBeStopped: MidnightWalletProvider[] = [];

  try {
    console.log();
    console.log(chalk.blue.bold("━".repeat(60)));
    console.log(chalk.blue.bold("🌙  Wallet Balance Checker"));
    console.log(chalk.blue.bold("━".repeat(60)));
    console.log();

    const seed = process.env.WALLET_SEED;
    if (!seed) {
      throw new Error("WALLET_SEED not found in .env file");
    }

    console.log(chalk.gray("Building wallet..."));
    console.log();

    // Get network configuration
    const logger = pino({ level: 'info' });
    const envConfig = EnvironmentManager.getEnvironmentConfiguration();

    // Build wallet from seed using FluentWalletBuilder
    const walletProvider = await MidnightWalletProvider.build(logger, envConfig, seed);
    providersToBeStopped.push(walletProvider);
    await walletProvider.start();

    // Wait for funds and get state
    const unshieldedState = await waitForUnshieldedFunds(
      logger,
      walletProvider.wallet,
      envConfig,
      unshieldedToken(),
      false, // Don't request from faucet automatically
    );

    const shieldedState = await getInitialShieldedState(logger, walletProvider.wallet.shielded as any);
    const address = shieldedState.address.coinPublicKeyString();

    console.log(chalk.cyan.bold("📍 Wallet Address:"));
    console.log(chalk.white(`   ${address}`));
    console.log();

    const balance = (unshieldedState.balances as any)[unshieldedToken().raw] || 0n;

    if (balance === 0n) {
      console.log(chalk.yellow.bold("💰 Balance: ") + chalk.red.bold("0 DUST"));
      console.log();
      console.log(chalk.red("❌ No funds detected."));
      console.log();
      console.log(chalk.magenta.bold("━".repeat(60)));
      console.log(chalk.magenta.bold("📝 How to Get Test Tokens:"));
      console.log(chalk.magenta.bold("━".repeat(60)));
      console.log();
      console.log(chalk.white("   1. ") + chalk.cyan("Visit: ") + chalk.underline("https://midnight.network/test-faucet"));
      console.log(chalk.white("   2. ") + chalk.cyan("Paste your wallet address (shown above)"));
      console.log(chalk.white("   3. ") + chalk.cyan("Request tokens from the faucet"));
      console.log(chalk.white("   4. ") + chalk.cyan("Wait 2-5 minutes for processing"));
      console.log(chalk.white("   5. ") + chalk.cyan("Run ") + chalk.yellow.bold("'npm run check-balance'") + chalk.cyan(" again"));
      console.log();
      console.log(chalk.gray("━".repeat(60)));
      console.log(chalk.gray("💡 Tip: Faucet transactions typically take 2-5 minutes to process."));
      console.log(chalk.gray("━".repeat(60)));
    } else {
      console.log(chalk.yellow.bold("💰 Balance: ") + chalk.green.bold(`${balance} DUST`));
      console.log();
      console.log(chalk.green.bold("✅ Wallet is funded and ready!"));
      console.log();
      console.log(chalk.magenta.bold("━".repeat(60)));
      console.log(chalk.magenta.bold("🚀 Next Step:"));
      console.log(chalk.magenta.bold("━".repeat(60)));
      console.log();
      console.log(chalk.cyan("   Deploy your contract with:"));
      console.log(chalk.yellow.bold("   npm run deploy"));
      console.log();
      console.log(chalk.gray("━".repeat(60)));
    }

    console.log();
    process.exit(0);
  } catch (error) {
    console.log();
    console.log(chalk.red.bold("❌ Error checking balance:"));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    console.log();
    process.exit(1);
  } finally {
    for (const provider of providersToBeStopped) {
      await provider.stop();
    }
  }
}

checkBalance();
