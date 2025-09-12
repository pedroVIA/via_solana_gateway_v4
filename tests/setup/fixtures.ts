import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  TEST_ADDRESSES,
  TEST_TX_IDS,
  TEST_PAYLOADS,
  CHAIN_IDS,
} from "./constants";
import {
  ethAddressFromHex,
  generateEthereumAddress,
  generateSolanaAddress,
} from "./helpers";

/**
 * Message Fixtures - Pre-configured test messages
 */

export const MESSAGE_FIXTURES = {
  // Simple Ethereum to Solana message
  ETH_TO_SOL_SIMPLE: {
    txId: TEST_TX_IDS.SIMPLE_TEST,
    sourceChainId: CHAIN_IDS.ETHEREUM_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: ethAddressFromHex(TEST_ADDRESSES.ETH_ADDRESS_1),
    recipient: generateSolanaAddress(),
    onChainData: TEST_PAYLOADS.SIMPLE,
    offChainData: TEST_PAYLOADS.EMPTY,
  },

  // Solana to Ethereum message
  SOL_TO_ETH_SIMPLE: {
    txId: new BN(50000),
    sourceChainId: CHAIN_IDS.SOLANA_LOCALNET,
    destChainId: CHAIN_IDS.ETHEREUM_MAINNET,
    sender: generateSolanaAddress(),
    recipient: ethAddressFromHex(TEST_ADDRESSES.ETH_ADDRESS_1),
    onChainData: TEST_PAYLOADS.MINT_COMMAND,
    offChainData: TEST_PAYLOADS.EMPTY,
  },

  // Polygon to Solana message
  POLYGON_TO_SOL: {
    txId: new BN(60000),
    sourceChainId: CHAIN_IDS.POLYGON_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: generateEthereumAddress(),
    recipient: generateSolanaAddress(),
    onChainData: TEST_PAYLOADS.JSON_MESSAGE,
    offChainData: Buffer.from("metadata"),
  },

  // Max size payload message
  MAX_PAYLOAD_MESSAGE: {
    txId: new BN(70000),
    sourceChainId: CHAIN_IDS.ETHEREUM_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: ethAddressFromHex(TEST_ADDRESSES.ETH_ADDRESS_2),
    recipient: generateSolanaAddress(),
    onChainData: TEST_PAYLOADS.MAX_SIZE,
    offChainData: TEST_PAYLOADS.EMPTY,
  },

  // Empty payload message
  EMPTY_PAYLOAD_MESSAGE: {
    txId: new BN(80000),
    sourceChainId: CHAIN_IDS.BSC_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: generateEthereumAddress(),
    recipient: generateSolanaAddress(),
    onChainData: TEST_PAYLOADS.EMPTY,
    offChainData: TEST_PAYLOADS.EMPTY,
  },
};

/**
 * Sequential Message Generator
 * Generates a series of messages with sequential TX IDs
 */
export class SequentialMessageGenerator {
  private currentTxId: BN;
  private sourceChainId: BN;
  private destChainId: BN;

  constructor(
    startTxId: BN = TEST_TX_IDS.SEQUENTIAL_START,
    sourceChainId: BN = CHAIN_IDS.ETHEREUM_MAINNET,
    destChainId: BN = CHAIN_IDS.SOLANA_LOCALNET
  ) {
    this.currentTxId = startTxId;
    this.sourceChainId = sourceChainId;
    this.destChainId = destChainId;
  }

  next() {
    const message = {
      txId: new BN(this.currentTxId.toString()),
      sourceChainId: this.sourceChainId,
      destChainId: this.destChainId,
      sender: generateEthereumAddress(),
      recipient: generateSolanaAddress(),
      onChainData: Buffer.from(`message_${this.currentTxId.toString()}`),
      offChainData: Buffer.from(""),
    };

    // Increment for next message
    this.currentTxId = this.currentTxId.add(new BN(1));

    return message;
  }

  nextBatch(count: number) {
    const messages = [];
    for (let i = 0; i < count; i++) {
      messages.push(this.next());
    }
    return messages;
  }

  reset(txId?: BN) {
    this.currentTxId = txId || TEST_TX_IDS.SEQUENTIAL_START;
  }
}

/**
 * Invalid Message Fixtures - Messages that should fail validation
 */
export const INVALID_MESSAGE_FIXTURES = {
  // Wrong recipient size (should be 20 or 32 bytes)
  INVALID_RECIPIENT_SIZE: {
    txId: new BN(90000),
    sourceChainId: CHAIN_IDS.ETHEREUM_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: generateEthereumAddress(),
    recipient: Buffer.alloc(15, 0xff), // Wrong size
    onChainData: TEST_PAYLOADS.SIMPLE,
    offChainData: TEST_PAYLOADS.EMPTY,
  },

  // TX ID that's too old (less than highest seen)
  OLD_TX_ID: {
    txId: new BN(1), // Very old TX ID
    sourceChainId: CHAIN_IDS.ETHEREUM_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: generateEthereumAddress(),
    recipient: generateSolanaAddress(),
    onChainData: TEST_PAYLOADS.SIMPLE,
    offChainData: TEST_PAYLOADS.EMPTY,
  },

  // Zero chain ID
  ZERO_CHAIN_ID: {
    txId: new BN(95000),
    sourceChainId: new BN(0), // Invalid
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: generateEthereumAddress(),
    recipient: generateSolanaAddress(),
    onChainData: TEST_PAYLOADS.SIMPLE,
    offChainData: TEST_PAYLOADS.EMPTY,
  },
};

/**
 * Account Fixtures - Pre-configured test accounts
 */
export class AccountFixtures {
  public readonly authority: Keypair;
  public readonly relayer: Keypair;
  public readonly attacker: Keypair;
  public readonly user1: Keypair;
  public readonly user2: Keypair;

  constructor() {
    // Generate deterministic keypairs for reproducible testing
    // In real tests, these would be funded with SOL
    this.authority = Keypair.generate();
    this.relayer = Keypair.generate();
    this.attacker = Keypair.generate();
    this.user1 = Keypair.generate();
    this.user2 = Keypair.generate();
  }

  getAllKeypairs(): Keypair[] {
    return [
      this.authority,
      this.relayer,
      this.attacker,
      this.user1,
      this.user2,
    ];
  }
}

/**
 * Batch Message Generator - Creates batches of messages for stress testing
 */
export function generateMessageBatch(
  count: number,
  options?: {
    sourceChainId?: BN;
    destChainId?: BN;
    startTxId?: BN;
    payload?: Buffer;
  }
) {
  const messages = [];
  const startTxId = options?.startTxId || new BN(100000);

  for (let i = 0; i < count; i++) {
    messages.push({
      txId: startTxId.add(new BN(i)),
      sourceChainId: options?.sourceChainId || CHAIN_IDS.ETHEREUM_MAINNET,
      destChainId: options?.destChainId || CHAIN_IDS.SOLANA_LOCALNET,
      sender: generateEthereumAddress(),
      recipient: generateSolanaAddress(),
      onChainData: options?.payload || Buffer.from(`batch_msg_${i}`),
      offChainData: Buffer.from(""),
    });
  }

  return messages;
}

/**
 * Edge Case Messages - Boundary conditions
 */
export const EDGE_CASE_FIXTURES = {
  // Minimum TX ID
  MIN_TX_ID: {
    txId: new BN(0),
    sourceChainId: CHAIN_IDS.AVALANCHE_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: generateEthereumAddress(),
    recipient: generateSolanaAddress(),
    onChainData: TEST_PAYLOADS.SIMPLE,
    offChainData: TEST_PAYLOADS.EMPTY,
  },

  // Maximum TX ID (u128 max)
  MAX_TX_ID: {
    txId: TEST_TX_IDS.EDGE_CASE_MAX,
    sourceChainId: CHAIN_IDS.ETHEREUM_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: generateEthereumAddress(),
    recipient: generateSolanaAddress(),
    onChainData: TEST_PAYLOADS.SIMPLE,
    offChainData: TEST_PAYLOADS.EMPTY,
  },

  // All fields at maximum
  ALL_MAX: {
    txId: TEST_TX_IDS.EDGE_CASE_MAX,
    sourceChainId: new BN("18446744073709551615"), // u64 max
    destChainId: new BN("18446744073709551615"), // u64 max
    sender: Buffer.alloc(32, 0xff),
    recipient: Buffer.alloc(32, 0xff),
    onChainData: TEST_PAYLOADS.MAX_SIZE,
    offChainData: TEST_PAYLOADS.MAX_SIZE,
  },
};

/**
 * Replay Attack Scenarios
 */
export const REPLAY_SCENARIOS = {
  // First valid message
  ORIGINAL_MESSAGE: {
    txId: TEST_TX_IDS.REPLAY_TEST_1,
    sourceChainId: CHAIN_IDS.ETHEREUM_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: ethAddressFromHex(TEST_ADDRESSES.ETH_ADDRESS_1),
    recipient: generateSolanaAddress(),
    onChainData: Buffer.from("original"),
    offChainData: Buffer.from(""),
  },

  // Attempted replay with same TX ID
  REPLAY_ATTEMPT: {
    txId: TEST_TX_IDS.REPLAY_TEST_1, // Same TX ID
    sourceChainId: CHAIN_IDS.ETHEREUM_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: ethAddressFromHex(TEST_ADDRESSES.ETH_ADDRESS_1),
    recipient: generateSolanaAddress(),
    onChainData: Buffer.from("replay"), // Different data
    offChainData: Buffer.from(""),
  },

  // Valid next message
  NEXT_VALID_MESSAGE: {
    txId: TEST_TX_IDS.REPLAY_TEST_2, // Different TX ID
    sourceChainId: CHAIN_IDS.ETHEREUM_MAINNET,
    destChainId: CHAIN_IDS.SOLANA_LOCALNET,
    sender: ethAddressFromHex(TEST_ADDRESSES.ETH_ADDRESS_1),
    recipient: generateSolanaAddress(),
    onChainData: Buffer.from("next_valid"),
    offChainData: Buffer.from(""),
  },
};
