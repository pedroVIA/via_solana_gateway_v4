import { BN } from "@coral-xyz/anchor";
import { Keypair, Ed25519Program, PublicKey } from "@solana/web3.js";
import { keccak256 } from "js-sha3";
import * as nacl from "tweetnacl";

/**
 * Create the exact same message hash that the Solana program generates
 */
export function createMessageHash(
  txId: BN,
  sourceChainId: BN,
  destChainId: BN,
  sender: Buffer,
  recipient: Buffer,
  onChainData: Buffer,
  offChainData: Buffer
): Buffer {
  const encoded: number[] = [];

  // u128 tx_id (16 bytes, little endian)
  const txIdBytes = txId.toArrayLike(Buffer, "le", 16);
  encoded.push(...Array.from(txIdBytes));

  // u64 source_chain_id (8 bytes, little endian)
  const sourceChainBytes = sourceChainId.toArrayLike(Buffer, "le", 8);
  encoded.push(...Array.from(sourceChainBytes));

  // u64 dest_chain_id (8 bytes, little endian)
  const destChainBytes = destChainId.toArrayLike(Buffer, "le", 8);
  encoded.push(...Array.from(destChainBytes));

  // Length-prefixed bytes (u32 length + data)
  encodeLengthPrefixed(encoded, sender);
  encodeLengthPrefixed(encoded, recipient);
  encodeLengthPrefixed(encoded, onChainData);
  encodeLengthPrefixed(encoded, offChainData);

  // Use keccak256 (same as Solana's keccak syscall)
  const hash = keccak256(new Uint8Array(encoded));

  return Buffer.from(hash, "hex");
}

/**
 * Encode data with length prefix (u32 length + data bytes)
 */
function encodeLengthPrefixed(buffer: number[], data: Buffer): void {
  // u32 length in little endian
  const length = data.length;
  buffer.push(length & 0xff);
  buffer.push((length >> 8) & 0xff);
  buffer.push((length >> 16) & 0xff);
  buffer.push((length >> 24) & 0xff);

  // Data bytes
  buffer.push(...Array.from(data));
}

/**
 * Create a valid Ed25519 signature for testing
 * Signs the actual message hash that the program will validate
 */
export function createValidSignature(
  txId: BN,
  sourceChainId: BN,
  destChainId: BN,
  sender: Buffer,
  recipient: Buffer,
  onChainData: Buffer,
  offChainData: Buffer,
  signer: Keypair
): {
  signature: number[];
  signer: any;
  messageHash: Buffer;
  ed25519Instruction: any;
} {
  // Create the exact message hash that the Solana program will validate
  const messageHash = createMessageHash(
    txId,
    sourceChainId,
    destChainId,
    sender,
    recipient,
    onChainData,
    offChainData
  );

  // Sign the actual message hash (32 bytes)
  const signature = nacl.sign.detached(messageHash, signer.secretKey);

  // Create the Ed25519 instruction that needs to be included in the transaction
  const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
    publicKey: signer.publicKey.toBytes(),
    message: messageHash,
    signature: signature,
  });

  // Extract the exact signature and pubkey bytes from the Ed25519 instruction
  // This ensures we pass the exact same data that will be validated
  const ed25519Data = ed25519Instruction.data;
  const instructionSignature = ed25519Data.slice(16, 80); // 64 bytes signature
  const instructionPubkey = ed25519Data.slice(80, 112); // 32 bytes pubkey

  // Create a PublicKey from the instruction bytes
  const instructionPublicKey = new PublicKey(instructionPubkey);

  // Convert to format expected by Solana program
  // Use the exact data from the Ed25519 instruction to ensure consistency
  return {
    signature: instructionSignature, // Use exact signature bytes from Ed25519 instruction
    signer: instructionPublicKey, // Use exact pubkey from Ed25519 instruction
    messageHash,
    ed25519Instruction,
  };
}
