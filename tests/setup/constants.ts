import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

/**
 * Chain ID Constants
 * These represent different blockchain networks in the Via Labs ecosystem
 */
export const CHAIN_IDS = {
  SOLANA_LOCALNET: new BN(1),
  ETHEREUM_MAINNET: new BN(2),
  POLYGON_MAINNET: new BN(3),
  BSC_MAINNET: new BN(4),
  AVALANCHE_MAINNET: new BN(5),
} as const;

/**
 * Test Configuration
 */
export const TEST_CONFIG = {
  AIRDROP_AMOUNT: 10 * anchor.web3.LAMPORTS_PER_SOL,
  CONFIRMATION_TIMEOUT: 30000, // 30 seconds
  DEFAULT_CONFIRMATIONS: 1,
  MAX_PAYLOAD_SIZE: 1024, // bytes
  MIN_PAYLOAD_SIZE: 1,
} as const;

/**
 * PDA Seeds
 */
export const PDA_SEEDS = {
  GATEWAY: "gateway",
  TX_ID: "tx",
  COUNTER: "counter",
} as const;

/**
 * Test Addresses (Example Ethereum addresses for testing)
 */
export const TEST_ADDRESSES = {
  ETH_ADDRESS_1: "742d35Cc3C6C6B48F83F4c3F6c97d8C2B61Ab2B4",
  ETH_ADDRESS_2: "0000000000000000000000000000000000000001",
  ETH_ADDRESS_3: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFff",
} as const;

/**
 * Error Messages for Validation
 */
export const ERROR_CODES = {
  SYSTEM_DISABLED: "SystemDisabled",
  UNAUTHORIZED: "Unauthorized",
  INVALID_TX_ID: "InvalidTxId",
  TX_ID_ALREADY_EXISTS: "TxIdAlreadyExists",
  ACCOUNT_NOT_INITIALIZED: "AccountNotInitialized",
  INVALID_DISCRIMINATOR: "Invalid account discriminator",
  DECLARED_PROGRAM_ID_MISMATCH: "DeclaredProgramIdMismatch",
} as const;

/**
 * Event Names
 */
export const EVENT_NAMES = {
  GATEWAY_INITIALIZED: "GatewayInitialized",
  MESSAGE_SENT: "MessageSent",
  MESSAGE_PROCESSED: "MessageProcessed",
  SYSTEM_STATUS_CHANGED: "SystemStatusChanged",
  TX_ID_CREATED: "TxIdCreated",
} as const;

/**
 * Compute Unit Limits
 * Used for performance testing and validation
 */
export const CU_LIMITS = {
  MAX_PER_TRANSACTION: 200000,
  EXPECTED_INITIALIZE: 20000,
  EXPECTED_SEND_MESSAGE: 15000,
  EXPECTED_CREATE_TX_PDA: 25000,
  EXPECTED_PROCESS_MESSAGE: 50000,
  EXPECTED_ADMIN: 10000,
  SIGNATURE_VERIFICATION: 36000,
} as const;

/**
 * Test Transaction IDs
 * Using predictable IDs for deterministic testing
 */
export const TEST_TX_IDS = {
  SIMPLE_TEST: new BN(10000),
  REPLAY_TEST_1: new BN(20000),
  REPLAY_TEST_2: new BN(20001),
  EDGE_CASE_MIN: new BN(0),
  EDGE_CASE_MAX: new BN("18446744073709551615"), // u128 max
  SEQUENTIAL_START: new BN(30000),
} as const;

/**
 * Test Payloads
 */
export const TEST_PAYLOADS = {
  EMPTY: Buffer.from(""),
  SIMPLE: Buffer.from("test"),
  MINT_COMMAND: Buffer.from("mint(100, USDC)"),
  MAX_SIZE: Buffer.alloc(TEST_CONFIG.MAX_PAYLOAD_SIZE, 0xff),
  JSON_MESSAGE: Buffer.from(
    JSON.stringify({ action: "transfer", amount: 100 })
  ),
} as const;

/**
 * Wait times for various operations
 */
export const WAIT_TIMES = {
  AIRDROP: 1000, // 1 second
  CONFIRMATION: 500, // 0.5 seconds
  BETWEEN_TESTS: 100, // 0.1 seconds
} as const;
