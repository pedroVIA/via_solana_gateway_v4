import { BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";

import {
  PublicKey,
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  Commitment,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { PDA_SEEDS } from "./constants";

/**
 * PDA Derivation Helpers
 */

export function deriveGatewayPDA(
  programId: PublicKey,
  chainId: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.GATEWAY), chainId.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

export function deriveTxIdPDA(
  programId: PublicKey,
  sourceChainId: BN,
  txId: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.TX_ID),
      sourceChainId.toArrayLike(Buffer, "le", 8),
      txId.toArrayLike(Buffer, "le", 16),
    ],
    programId
  );
}

export function deriveCounterPDA(
  programId: PublicKey,
  sourceChainId: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.COUNTER),
      sourceChainId.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Account Helpers
 */

export async function fundAccount(
  connection: Connection,
  account: PublicKey,
  lamports: number
): Promise<string> {
  const signature = await connection.requestAirdrop(account, lamports);
  await confirmTransaction(connection, signature);
  return signature;
}

export async function createFundedKeypair(
  connection: Connection,
  lamports: number = 2 * LAMPORTS_PER_SOL
): Promise<Keypair> {
  const keypair = Keypair.generate();
  await fundAccount(connection, keypair.publicKey, lamports);
  return keypair;
}

export async function accountExists(
  connection: Connection,
  pubkey: PublicKey
): Promise<boolean> {
  try {
    const info = await connection.getAccountInfo(pubkey);
    return info !== null;
  } catch {
    return false;
  }
}

export async function getAccountBalance(
  connection: Connection,
  pubkey: PublicKey
): Promise<number> {
  return await connection.getBalance(pubkey);
}

/**
 * Transaction Helpers
 */

export async function confirmTransaction(
  connection: Connection,
  signature: string,
  commitment: Commitment = "confirmed"
): Promise<void> {
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    commitment
  );
}

export async function getTransactionLogs(
  connection: Connection,
  signature: string
): Promise<string[]> {
  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  return tx?.meta?.logMessages || [];
}

export async function measureComputeUnits(
  connection: Connection,
  instruction: TransactionInstruction,
  payer: Keypair
): Promise<number> {
  // Create a transaction with compute budget instruction
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 300000,
  });

  const transaction = new Transaction()
    .add(modifyComputeUnits)
    .add(instruction);

  // Send and get logs
  const signature = await connection.sendTransaction(transaction, [payer]);
  await confirmTransaction(connection, signature);

  const logs = await getTransactionLogs(connection, signature);

  // Parse compute units from logs
  for (const log of logs) {
    const match = log.match(/consumed (\d+) of/);
    if (match) {
      return parseInt(match[1]);
    }
  }

  return 0;
}

/**
 * Event Parsing Helpers
 */

export interface ParsedEvent {
  name: string;
  data: any;
}

export async function getEventsFromTransaction(
  connection: Connection,
  signature: string
): Promise<ParsedEvent[]> {
  const logs = await getTransactionLogs(connection, signature);
  const events: ParsedEvent[] = [];

  for (const log of logs) {
    if (log.includes("Program data:")) {
      // Parse base64 encoded event data
      const dataMatch = log.match(/Program data: (.+)/);
      if (dataMatch) {
        try {
          // This is simplified - actual parsing would decode based on IDL
          events.push({
            name: "UnknownEvent",
            data: dataMatch[1],
          });
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
  }

  return events;
}

/**
 * Address Generation Helpers
 */

export function generateEthereumAddress(): Buffer {
  // Generate a random 20-byte Ethereum address
  const address = Buffer.alloc(20);
  for (let i = 0; i < 20; i++) {
    address[i] = Math.floor(Math.random() * 256);
  }
  return address;
}

export function generateSolanaAddress(): Buffer {
  // Generate a random Solana pubkey as bytes
  const keypair = Keypair.generate();
  return Buffer.from(keypair.publicKey.toBytes());
}

export function ethAddressFromHex(hex: string): Buffer {
  // Remove 0x prefix if present
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(cleanHex, "hex");
}

/**
 * Test Data Generators
 */

export interface TestMessage {
  txId: BN;
  sourceChainId: BN;
  destChainId: BN;
  sender: Buffer;
  recipient: Buffer;
  onChainData: Buffer;
  offChainData: Buffer;
}

export function generateTestMessage(
  overrides?: Partial<TestMessage>
): TestMessage {
  return {
    txId: new BN(Math.floor(Math.random() * 1000000)),
    sourceChainId: new BN(2),
    destChainId: new BN(1),
    sender: generateEthereumAddress(),
    recipient: generateSolanaAddress(),
    onChainData: Buffer.from("test_data"),
    offChainData: Buffer.from(""),
    ...overrides,
  };
}

/**
 * Assertion Helpers
 */

export function assertErrorCode(error: any, expectedCode: string): boolean {
  const errorString = error.toString();
  return (
    errorString.includes(expectedCode) ||
    error.message?.includes(expectedCode) ||
    error.error?.errorCode?.code === expectedCode
  );
}

export async function expectRevert(
  promise: Promise<any>,
  expectedError?: string
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected transaction to revert but it succeeded");
  } catch (error: any) {
    if (error.message === "Expected transaction to revert but it succeeded") {
      throw error;
    }
    if (expectedError && !assertErrorCode(error, expectedError)) {
      throw new Error(`Expected error "${expectedError}" but got "${error}"`);
    }
    // Error occurred as expected
  }
}

/**
 * Time Helpers
 */

export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Logging Helpers
 */

export function logTestHeader(testName: string): void {
  console.log("\n" + "═".repeat(60));
  console.log(`TEST: ${testName}`);
  console.log("═".repeat(60));
}

export function logSubtest(description: string): void {
  console.log(`\n→ ${description}`);
}

export function logSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

export function logInfo(key: string, value: any): void {
  console.log(`  ${key}: ${value}`);
}

export function logTransaction(signature: string): void {
  console.log(`  TX: ${signature}`);
}

export function logComputeUnits(cu: number, expected?: number): void {
  const isEfficient = !expected || cu <= expected;
  const status = isEfficient ? "✅" : "⚠️";

  if (expected) {
    const efficiency = Math.round((cu / expected) * 100);
    console.log(
      `  ${status} CU: ${cu.toLocaleString()} (${efficiency}% of expected)`
    );
  } else {
    console.log(`  ${status} CU: ${cu.toLocaleString()}`);
  }
}

/**
 * Enhanced transaction logging with compute unit tracking
 */
export async function logTransactionWithCU(
  signature: string,
  connection: Connection,
  context?: any,
  operationName?: string,
  expectedCU?: number
): Promise<number> {
  logTransaction(signature);

  try {
    // Confirm transaction
    const confirmation = await connection.confirmTransaction(
      signature,
      "confirmed"
    );

    if (confirmation.value.err) {
      console.log(`  ❌ Failed: ${confirmation.value.err}`);
      return 0;
    }

    // Fetch transaction details with retry
    let transaction;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      transaction = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (transaction) break;

      attempts++;
      if (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (!transaction) {
      console.log(`  ⚠️ Could not fetch CU data`);
      return 0;
    }

    const computeUnitsUsed = transaction.meta?.computeUnitsConsumed || 0;

    // Update context metrics
    if (context && typeof context.addComputeUnits === "function") {
      context.addComputeUnits(computeUnitsUsed);
    }

    // Simple performance logging
    logComputeUnits(computeUnitsUsed, expectedCU);

    return computeUnitsUsed;
  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
    return 0;
  }
}
