import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  type ShieldedCoinInfo,
  type UnprovenTransaction,
  ZswapSecretKeys,
} from '@midnight-ntwrk/ledger-v6';
import {
  type BalancedProvingRecipe,
  type MidnightProvider,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { Logger } from 'pino';

import { getInitialShieldedState } from './wallet-utils.js';
import { DustWalletOptions, EnvironmentConfiguration, FluentWalletBuilder } from '@midnight-ntwrk/testkit-js';

export const DEFAULT_DUST_OPTIONS: DustWalletOptions = {
  ledgerParams: LedgerParameters.initialParameters(),
  additionalFeeOverhead: 1_000n, // Reduced from default to allow transactions
  feeBlocksMargin: 5,
};

/**
 * Provider class that implements wallet functionality for the Midnight network.
 * Handles transaction balancing, submission, and wallet state management.
 */
export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  logger: Logger;
  readonly wallet: WalletFacade;
  readonly zswapSecretKeys: ZswapSecretKeys;
  readonly dustSecretKey: DustSecretKey;

  private constructor(
    logger: Logger,
    wallet: WalletFacade,
    zswapSecretKeys: ZswapSecretKeys,
    dustSecretKey: DustSecretKey,
  ) {
    this.logger = logger;
    this.wallet = wallet;
    this.zswapSecretKeys = zswapSecretKeys;
    this.dustSecretKey = dustSecretKey;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(
    tx: UnprovenTransaction,
    _newCoins: ShieldedCoinInfo[],
    ttl: Date = ttlOneHour(),
  ): Promise<BalancedProvingRecipe> {
    return this.wallet.balanceTransaction(this.zswapSecretKeys, this.dustSecretKey, tx, ttl);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  static async build(logger: Logger, env: EnvironmentConfiguration, seed?: string): Promise<MidnightWalletProvider> {
    const builder = FluentWalletBuilder.forEnvironment(env).withDustOptions(DEFAULT_DUST_OPTIONS);
    const { wallet, seeds } = seed
      ? await builder.withSeed(seed).buildWithoutStarting()
      : await builder.withRandomSeed().buildWithoutStarting();

    const initialState = await getInitialShieldedState(logger, wallet.shielded as any);
    logger.info(
      `Your wallet seed is: ${seeds.masterSeed} and your address is: ${initialState.address.coinPublicKeyString()}`,
    );

    return new MidnightWalletProvider(
      logger,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
    );
  }

  static async withWallet(
    logger: Logger,
    wallet: WalletFacade,
    zswapSecretKeys: ZswapSecretKeys,
    dustSecretKey: DustSecretKey,
  ): Promise<MidnightWalletProvider> {
    const initialState = await getInitialShieldedState(logger, wallet.shielded as any);
    logger.info(
      `Your wallet address is: ${initialState.address.coinPublicKeyString()}`,
    );

    return new MidnightWalletProvider(logger, wallet, zswapSecretKeys, dustSecretKey);
  }
}
