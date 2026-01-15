import "dotenv/config";
import * as readline from "readline/promises";
import { WalletBuilder } from "@midnight-ntwrk/wallet";
import { findDeployedContract, submitCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import {
  getNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import { Transaction } from "@midnight-ntwrk/ledger-v6";
import { Transaction as ZswapTransaction } from "@midnight-ntwrk/zswap";
import { WebSocket } from "ws";
import * as path from "path";
import * as fs from "fs";
import * as Rx from "rxjs";
import { MidnightProviders } from "./providers/midnight-providers.js";
import { EnvironmentManager } from "./utils/environment.js";

// Fix WebSocket for Node.js environment
// @ts-ignore
globalThis.WebSocket = WebSocket;

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("🌙 lending-borowing-app CLI\n");

  try {
    // Validate environment
    EnvironmentManager.validateEnvironment();

    // Check for deployment file
    if (!fs.existsSync("deployment.json")) {
      console.error("❌ No deployment.json found! Run npm run deploy first.");
      process.exit(1);
    }

    const deployment = JSON.parse(fs.readFileSync("deployment.json", "utf-8"));
    console.log(`Contract: ${deployment.contractAddress}\n`);

    const networkConfig = EnvironmentManager.getNetworkConfig();
    const contractName =
      deployment.contractName || process.env.CONTRACT_NAME || "lending-pool";
    const walletSeed = process.env.WALLET_SEED!;
    const networkId = process.env.MIDNIGHT_NETWORK || "preview";

    console.log("Connecting to Midnight network...");

    // Build wallet
    const wallet = await WalletBuilder.buildFromSeed(
      networkConfig.indexer,
      networkConfig.indexerWS,
      networkConfig.proofServer,
      networkConfig.node,
      walletSeed,
      networkId as any, // NetworkId type - wallet package may still expect enum
      "info"
    );

    wallet.start();

    // Wait for sync
    await Rx.firstValueFrom(
      wallet.state().pipe(Rx.filter((s) => s.syncProgress?.synced === true))
    );

    // Load contract
    const contractPath = path.join(process.cwd(), "contracts");
    const contractModulePath = path.join(
      contractPath,
      "managed",
      contractName,
      "contract",
      "index.js"
    );
    const LendingPoolModule = await import(contractModulePath);

    // Create wallet provider
    const walletState = await Rx.firstValueFrom(wallet.state());

    const walletProvider = {
      getCoinPublicKey: () => walletState.coinPublicKey,
      getEncryptionPublicKey: () => walletState.encryptionPublicKey,
      async balanceTx(tx: any, newCoins?: any, ttl?: Date): Promise<any> {
        // v3.0.0: balanceTx should return BalancedProvingRecipe
        // Contract calls handle the recipe internally
        const networkIdStr = networkId as any; // NetworkId type for transaction serialization
        const zswapTx = await wallet
          .balanceTransaction(
            ZswapTransaction.deserialize(
              tx.serialize(networkIdStr),
              networkIdStr
            ),
            newCoins
          )
          .then((tx) => wallet.proveTransaction(tx));
        
        // v3.0.0: Transaction.deserialize signature changed - return zswapTx directly
        // The contract call functions will handle the conversion
        // Return as NothingToProve since transaction is already proven
        return {
          type: 'NothingToProve',
          transaction: zswapTx as any // Transaction type - conversion handled by SDK
        };
      },
      async submitTx(tx: any): Promise<string> {
        return await wallet.submitTransaction(tx);
      },
    };

    // Configure providers
    const providers = MidnightProviders.create({
      contractName,
      walletProvider,
      networkConfig,
    });

    // Create contract instance with witness functions
    // Witness functions provide private inputs (amounts, secret key, timestamp)
    // These are called automatically when circuits are executed
    const contractInstance = new LendingPoolModule.Contract({
      userSecretKey: async (context: any) => {
        // In production, this would use a secure key management system
        // For now, prompt user for secret key (should be stored securely)
        const secretKeyHex = await rl.question("Enter your secret key (hex, 64 chars): ");
        if (secretKeyHex.length !== 64) {
          throw new Error("Secret key must be 64 hex characters (32 bytes)");
        }
        const secretKey = Buffer.from(secretKeyHex, "hex");
        return [context.privateState, secretKey];
      },
      depositAmount: async (context: any) => {
        const amountStr = await rl.question("Enter deposit amount: ");
        const amount = BigInt(amountStr);
        return [context.privateState, amount];
      },
      withdrawAmount: async (context: any) => {
        const amountStr = await rl.question("Enter withdrawal amount: ");
        const amount = BigInt(amountStr);
        return [context.privateState, amount];
      },
      borrowAmount: async (context: any) => {
        const amountStr = await rl.question("Enter borrow amount: ");
        const amount = BigInt(amountStr);
        return [context.privateState, amount];
      },
      repayAmount: async (context: any) => {
        const amountStr = await rl.question("Enter repayment amount: ");
        const amount = BigInt(amountStr);
        return [context.privateState, amount];
      },
      currentTimestamp: async (context: any) => {
        // Return current timestamp in seconds
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        return [context.privateState, timestamp];
      },
    });

    // Connect to contract
    const deployed: any = await findDeployedContract(providers, {
      contractAddress: deployment.contractAddress,
      contract: contractInstance,
      privateStateId: "lendingPoolState",
      initialPrivateState: {},
    });

    console.log("✅ Connected to contract\n");

    // Main menu loop
    let running = true;
    while (running) {
      console.log("--- Lending Pool Menu ---");
      console.log("1. Deposit assets");
      console.log("2. Withdraw assets");
      console.log("3. Borrow assets");
      console.log("4. Repay borrowed assets");
      console.log("5. View pool state");
      console.log("6. Exit");

      const choice = await rl.question("\nYour choice: ");

      switch (choice) {
        case "1":
          console.log("\nDepositing assets...");
          const depositAsset = await rl.question("Enter asset address (hex, 64 chars): ");
          const depositOnBehalfOf = await rl.question("Enter recipient address (hex, 64 chars): ");
          try {
            // Convert hex strings to Uint8Array (32 bytes = 64 hex chars)
            if (depositAsset.length !== 64 || depositOnBehalfOf.length !== 64) {
              throw new Error("Addresses must be 64 hex characters (32 bytes)");
            }
            const assetBytes = Buffer.from(depositAsset, "hex");
            const onBehalfOfBytes = Buffer.from(depositOnBehalfOf, "hex");
            
            // Use high-level submitCallTx function (matching migration example)
            const result = await submitCallTx(providers, {
              contract: contractInstance,
              circuit: "deposit",
              args: [assetBytes, onBehalfOfBytes],
            } as any);
            console.log("✅ Deposit successful!");
            console.log(`Transaction ID: ${(result as any).txId}\n`);
          } catch (error) {
            console.error("❌ Failed to deposit:", error);
          }
          break;

        case "2":
          console.log("\nWithdrawing assets...");
          const withdrawAsset = await rl.question("Enter asset address (hex, 64 chars): ");
          const withdrawTo = await rl.question("Enter recipient address (hex, 64 chars): ");
          try {
            if (withdrawAsset.length !== 64 || withdrawTo.length !== 64) {
              throw new Error("Addresses must be 64 hex characters (32 bytes)");
            }
            const assetBytes = Buffer.from(withdrawAsset, "hex");
            const toBytes = Buffer.from(withdrawTo, "hex");
            
            // Use high-level submitCallTx function (matching migration example)
            const result = await submitCallTx(providers, {
              contract: contractInstance,
              circuit: "withdraw",
              args: [assetBytes, toBytes],
            } as any);
            console.log("✅ Withdrawal successful!");
            console.log(`Transaction ID: ${(result as any).txId}\n`);
          } catch (error) {
            console.error("❌ Failed to withdraw:", error);
          }
          break;

        case "3":
          console.log("\nBorrowing assets...");
          const borrowAsset = await rl.question("Enter asset address (hex, 64 chars): ");
          try {
            if (borrowAsset.length !== 64) {
              throw new Error("Address must be 64 hex characters (32 bytes)");
            }
            const assetBytes = Buffer.from(borrowAsset, "hex");
            // InterestRateMode.VARIABLE = 2
            // Use high-level submitCallTx function (matching migration example)
            const result = await submitCallTx(providers, {
              contract: contractInstance,
              circuit: "borrow",
              args: [assetBytes, 2],
            } as any);
            console.log("✅ Borrow successful!");
            console.log(`Transaction ID: ${(result as any).txId}\n`);
          } catch (error) {
            console.error("❌ Failed to borrow:", error);
          }
          break;

        case "4":
          console.log("\nRepaying borrowed assets...");
          const repayAsset = await rl.question("Enter asset address (hex, 64 chars): ");
          try {
            if (repayAsset.length !== 64) {
              throw new Error("Address must be 64 hex characters (32 bytes)");
            }
            const assetBytes = Buffer.from(repayAsset, "hex");
            // InterestRateMode.VARIABLE = 2
            // Use high-level submitCallTx function (matching migration example)
            const result = await submitCallTx(providers, {
              contract: contractInstance,
              circuit: "repay",
              args: [assetBytes, 2],
            } as any);
            console.log("✅ Repayment successful!");
            console.log(`Transaction ID: ${(result as any).txId}\n`);
          } catch (error) {
            console.error("❌ Failed to repay:", error);
          }
          break;

        case "5":
          console.log("\nReading pool state from blockchain...");
          try {
            const state = await providers.publicDataProvider.queryContractState(
              deployment.contractAddress
            );
            if (state) {
              const ledger = LendingPoolModule.ledger(state.data);
              console.log("📋 Pool State:");
              console.log(`   Admin: ${Buffer.from(ledger.admin).toString("hex")}`);
              console.log(`   Interest Rate Model: ${Buffer.from(ledger.interestRateModel).toString("hex")}`);
              console.log(`   Oracle: ${Buffer.from(ledger.oracle).toString("hex")}`);
              console.log(`   Sequence: ${ledger.sequence}`);
              console.log(`   Reserves: ${ledger.reserves.size()} asset(s)`);
              console.log(`   User Accounts: ${ledger.userAccounts.size()} account(s)\n`);
            } else {
              console.log("📋 No state found\n");
            }
          } catch (error) {
            console.error("❌ Failed to read state:", error);
          }
          break;

        case "6":
          running = false;
          console.log("\n👋 Goodbye!");
          break;

        default:
          console.log("❌ Invalid choice. Please enter 1-6.\n");
      }
    }

    // Clean up
    await wallet.close();
  } catch (error) {
    console.error("\n❌ Error:", error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);
