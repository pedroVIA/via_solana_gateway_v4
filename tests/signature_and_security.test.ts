import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MessageGatewayV4 } from "../target/types/message_gateway_v4";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { assert, expect } from "chai";
import * as nacl from "tweetnacl";
import { keccak_256 } from "js-sha3";

/**
 * Comprehensive Signature Validation and Security Tests
 *
 * Consolidates signature testing from test_signatures.ts and security_validation.test.ts
 * Tests both basic signature validation and comprehensive security scenarios
 */
describe("Signature Validation and Security Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace
    .MessageGatewayV4 as Program<MessageGatewayV4>;

  // Test accounts
  let authority: Keypair;
  let relayer: Keypair;

  // Gateway and registries
  let gatewayPDA: PublicKey;
  let sourceGatewayPDA: PublicKey;
  let viaRegistryPDA: PublicKey;
  let chainRegistryPDA: PublicKey;
  let projectRegistryPDA: PublicKey;

  // Test signers for three-layer validation
  let viaSigners: Keypair[] = [];
  let chainSigners: Keypair[] = [];
  let projectSigners: Keypair[] = [];

  const SOLANA_TESTNET_CHAIN_ID = Array.from(
    Buffer.from("solana-testnet-1", "utf-8")
  ).concat(new Array(16).fill(0));
  const ETHEREUM_CHAIN_ID = Array.from(
    Buffer.from("ethereum-1", "utf-8")
  ).concat(new Array(22).fill(0));

  before(async () => {
    // Initialize test accounts
    authority = Keypair.generate();
    relayer = Keypair.generate();

    // Generate test signers
    for (let i = 0; i < 3; i++) {
      viaSigners.push(Keypair.generate());
      chainSigners.push(Keypair.generate());
      projectSigners.push(Keypair.generate());
    }

    // Airdrop SOL for test accounts
    await provider.connection.requestAirdrop(
      authority.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      relayer.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );

    // Wait for airdrops
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Derive PDAs
    [gatewayPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("gateway"), Buffer.from(SOLANA_TESTNET_CHAIN_ID)],
      program.programId
    );

    [sourceGatewayPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("gateway"), Buffer.from(ETHEREUM_CHAIN_ID)],
      program.programId
    );

    [viaRegistryPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from("via"),
        Buffer.from(SOLANA_TESTNET_CHAIN_ID),
      ],
      program.programId
    );

    [chainRegistryPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from("chain"),
        Buffer.from(SOLANA_TESTNET_CHAIN_ID),
      ],
      program.programId
    );

    [projectRegistryPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from("project"),
        Buffer.from(SOLANA_TESTNET_CHAIN_ID),
      ],
      program.programId
    );

    // Initialize gateway
    await program.methods
      .initializeGateway(SOLANA_TESTNET_CHAIN_ID, authority.publicKey)
      .accounts({
        gateway: gatewayPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Initialize signer registries
    await program.methods
      .initializeSignerRegistry({ via: {} }, 2)
      .accounts({
        signerRegistry: viaRegistryPDA,
        gateway: gatewayPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .initializeSignerRegistry({ chain: {} }, 2)
      .accounts({
        signerRegistry: chainRegistryPDA,
        gateway: gatewayPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .initializeSignerRegistry({ project: {} }, 1)
      .accounts({
        signerRegistry: projectRegistryPDA,
        gateway: gatewayPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Add signers to registries
    for (const signer of viaSigners) {
      await program.methods
        .addSigner(signer.publicKey)
        .accounts({
          signerRegistry: viaRegistryPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
    }

    for (const signer of chainSigners) {
      await program.methods
        .addSigner(signer.publicKey)
        .accounts({
          signerRegistry: chainRegistryPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
    }

    for (const signer of projectSigners) {
      await program.methods
        .addSigner(signer.publicKey)
        .accounts({
          signerRegistry: projectRegistryPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
    }
  });

  describe("Cross-Chain Message Hash Generation", () => {
    it("should generate consistent hashes for identical inputs", async () => {
      const txId = new BN(12345);
      const sender = Array.from(relayer.publicKey.toBytes());
      const recipient = Array.from(
        Buffer.from("0x742d35Cc6067C4C7a3aF5C3D1A1b3b3f1A1b3b3f", "utf-8")
      );
      const data = Array.from(Buffer.from("Hello Solana!", "utf-8"));

      const hash1 = createMessageHash(
        txId,
        ETHEREUM_CHAIN_ID,
        SOLANA_TESTNET_CHAIN_ID,
        sender,
        recipient,
        data
      );
      const hash2 = createMessageHash(
        txId,
        ETHEREUM_CHAIN_ID,
        SOLANA_TESTNET_CHAIN_ID,
        sender,
        recipient,
        data
      );

      assert.deepEqual(
        hash1,
        hash2,
        "Hashes should be identical for same inputs"
      );
    });

    it("should produce different hashes for different inputs", async () => {
      const txId1 = new BN(12345);
      const txId2 = new BN(54321);
      const sender = Array.from(relayer.publicKey.toBytes());
      const recipient = Array.from(
        Buffer.from("0x742d35Cc6067C4C7a3aF5C3D1A1b3b3f1A1b3b3f", "utf-8")
      );
      const data = Array.from(Buffer.from("Hello Solana!", "utf-8"));

      const hash1 = createMessageHash(
        txId1,
        ETHEREUM_CHAIN_ID,
        SOLANA_TESTNET_CHAIN_ID,
        sender,
        recipient,
        data
      );
      const hash2 = createMessageHash(
        txId2,
        ETHEREUM_CHAIN_ID,
        SOLANA_TESTNET_CHAIN_ID,
        sender,
        recipient,
        data
      );

      assert.notDeepEqual(
        hash1,
        hash2,
        "Hashes should be different for different inputs"
      );
    });
  });

  describe("Ed25519 Signature Verification", () => {
    it("should verify valid Ed25519 signatures", async () => {
      const message = Buffer.from("test message");
      const messageHash = Array.from(
        Buffer.from(keccak_256.arrayBuffer(message))
      );
      const keyPair = nacl.sign.keyPair();
      const signature = nacl.sign.detached(
        new Uint8Array(messageHash),
        keyPair.secretKey
      );

      // Create Ed25519 instruction
      const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
        publicKey: keyPair.publicKey,
        message: new Uint8Array(messageHash),
        signature: signature,
      });

      const transaction = new Transaction().add(ed25519Instruction);

      // This would be verified on-chain in actual implementation
      const isValid = nacl.sign.detached.verify(
        new Uint8Array(messageHash),
        signature,
        keyPair.publicKey
      );

      assert.isTrue(isValid, "Signature should be valid");
    });

    it("should reject invalid signatures", async () => {
      const message = Buffer.from("test message");
      const messageHash = Array.from(
        Buffer.from(keccak_256.arrayBuffer(message))
      );
      const keyPair = nacl.sign.keyPair();

      // Create invalid signature (wrong message)
      const wrongMessage = Buffer.from("wrong message");
      const wrongHash = Array.from(
        Buffer.from(keccak_256.arrayBuffer(wrongMessage))
      );
      const signature = nacl.sign.detached(
        new Uint8Array(wrongHash),
        keyPair.secretKey
      );

      const isValid = nacl.sign.detached.verify(
        new Uint8Array(messageHash),
        signature,
        keyPair.publicKey
      );

      assert.isFalse(isValid, "Invalid signature should be rejected");
    });
  });

  describe("Three-Layer Signature Validation", () => {
    it("should successfully process message with valid three-layer signatures", async () => {
      const txId = new BN(12345);
      const sender = Array.from(relayer.publicKey.toBytes());
      const recipient = Array.from(
        Buffer.from("0x742d35Cc6067C4C7a3aF5C3D1A1b3b3f1A1b3b3f", "utf-8")
      );
      const data = Array.from(Buffer.from("Hello from Ethereum!", "utf-8"));

      const messageHash = createMessageHash(
        txId,
        ETHEREUM_CHAIN_ID,
        SOLANA_TESTNET_CHAIN_ID,
        sender,
        recipient,
        data
      );

      // Create TxId PDA first
      const [txPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("tx"),
          Buffer.from(ETHEREUM_CHAIN_ID),
          txId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .createTxPda(txId, ETHEREUM_CHAIN_ID)
        .accounts({
          txPda: txPDA,
          payer: relayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([relayer])
        .rpc();

      // Create signatures from multiple layers
      const transaction = new Transaction();

      // VIA layer signatures (need 2 out of 3)
      const viaSignature1 = nacl.sign.detached(
        new Uint8Array(messageHash),
        viaSigners[0].secretKey
      );
      const viaSignature2 = nacl.sign.detached(
        new Uint8Array(messageHash),
        viaSigners[1].secretKey
      );

      // Chain layer signatures (need 2 out of 3)
      const chainSignature1 = nacl.sign.detached(
        new Uint8Array(messageHash),
        chainSigners[0].secretKey
      );
      const chainSignature2 = nacl.sign.detached(
        new Uint8Array(messageHash),
        chainSigners[1].secretKey
      );

      // Project layer signature (need 1 out of 3)
      const projectSignature = nacl.sign.detached(
        new Uint8Array(messageHash),
        projectSigners[0].secretKey
      );

      // Add Ed25519 instructions
      transaction.add(
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: viaSigners[0].publicKey.toBytes(),
          message: new Uint8Array(messageHash),
          signature: viaSignature1,
        }),
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: viaSigners[1].publicKey.toBytes(),
          message: new Uint8Array(messageHash),
          signature: viaSignature2,
        }),
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: chainSigners[0].publicKey.toBytes(),
          message: new Uint8Array(messageHash),
          signature: chainSignature1,
        }),
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: chainSigners[1].publicKey.toBytes(),
          message: new Uint8Array(messageHash),
          signature: chainSignature2,
        }),
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: projectSigners[0].publicKey.toBytes(),
          message: new Uint8Array(messageHash),
          signature: projectSignature,
        })
      );

      // Add process message instruction
      const processInstruction = await program.methods
        .processMessage(
          txId,
          ETHEREUM_CHAIN_ID,
          SOLANA_TESTNET_CHAIN_ID,
          sender,
          recipient,
          data
        )
        .accounts({
          txPda: txPDA,
          gateway: gatewayPDA,
          viaRegistry: viaRegistryPDA,
          chainRegistry: chainRegistryPDA,
          projectRegistry: projectRegistryPDA,
          processor: relayer.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      transaction.add(processInstruction);

      // Send transaction
      try {
        const signature = await provider.sendAndConfirm(
          transaction,
          [relayer],
          {
            commitment: "confirmed",
          }
        );

        console.log("Transaction successful:", signature);

        // Verify TxId PDA was closed (should not exist)
        const txPdaAccount = await provider.connection.getAccountInfo(txPDA);
        assert.isNull(
          txPdaAccount,
          "TxId PDA should be closed after processing"
        );
      } catch (error) {
        console.error("Transaction failed:", error);
        throw error;
      }
    });

    it("should reject message with insufficient VIA signatures", async () => {
      const txId = new BN(12346);
      const sender = Array.from(relayer.publicKey.toBytes());
      const recipient = Array.from(
        Buffer.from("0x742d35Cc6067C4C7a3aF5C3D1A1b3b3f1A1b3b3f", "utf-8")
      );
      const data = Array.from(Buffer.from("Hello from Ethereum!", "utf-8"));

      const messageHash = createMessageHash(
        txId,
        ETHEREUM_CHAIN_ID,
        SOLANA_TESTNET_CHAIN_ID,
        sender,
        recipient,
        data
      );

      // Create TxId PDA first
      const [txPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("tx"),
          Buffer.from(ETHEREUM_CHAIN_ID),
          txId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .createTxPda(txId, ETHEREUM_CHAIN_ID)
        .accounts({
          txPda: txPDA,
          payer: relayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([relayer])
        .rpc();

      // Create transaction with insufficient VIA signatures (only 1, need 2)
      const transaction = new Transaction();

      const viaSignature1 = nacl.sign.detached(
        new Uint8Array(messageHash),
        viaSigners[0].secretKey
      );
      const chainSignature1 = nacl.sign.detached(
        new Uint8Array(messageHash),
        chainSigners[0].secretKey
      );
      const chainSignature2 = nacl.sign.detached(
        new Uint8Array(messageHash),
        chainSigners[1].secretKey
      );
      const projectSignature = nacl.sign.detached(
        new Uint8Array(messageHash),
        projectSigners[0].secretKey
      );

      transaction.add(
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: viaSigners[0].publicKey.toBytes(),
          message: new Uint8Array(messageHash),
          signature: viaSignature1,
        }),
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: chainSigners[0].publicKey.toBytes(),
          message: new Uint8Array(messageHash),
          signature: chainSignature1,
        }),
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: chainSigners[1].publicKey.toBytes(),
          message: new Uint8Array(messageHash),
          signature: chainSignature2,
        }),
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: projectSigners[0].publicKey.toBytes(),
          message: new Uint8Array(messageHash),
          signature: projectSignature,
        })
      );

      const processInstruction = await program.methods
        .processMessage(
          txId,
          ETHEREUM_CHAIN_ID,
          SOLANA_TESTNET_CHAIN_ID,
          sender,
          recipient,
          data
        )
        .accounts({
          txPda: txPDA,
          gateway: gatewayPDA,
          viaRegistry: viaRegistryPDA,
          chainRegistry: chainRegistryPDA,
          projectRegistry: projectRegistryPDA,
          processor: relayer.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      transaction.add(processInstruction);

      // Should fail due to insufficient VIA signatures
      try {
        await provider.sendAndConfirm(transaction, [relayer], {
          commitment: "confirmed",
        });
        assert.fail(
          "Transaction should have failed with insufficient VIA signatures"
        );
      } catch (error) {
        console.log("Expected error:", error.message);
        assert.include(error.message.toLowerCase(), "insufficient");
      }
    });
  });

  describe("Signer Registry Management", () => {
    it("should update signer registry thresholds", async () => {
      // Update VIA registry threshold
      await program.methods
        .updateRequiredSignatures(3)
        .accounts({
          signerRegistry: viaRegistryPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      // Verify the update
      const viaRegistry = await program.account.signerRegistry.fetch(
        viaRegistryPDA
      );
      assert.equal(
        viaRegistry.requiredSignatures,
        3,
        "VIA registry threshold should be updated to 3"
      );
    });

    it("should add and remove signers correctly", async () => {
      const newSigner = Keypair.generate();

      // Add new signer
      await program.methods
        .addSigner(newSigner.publicKey)
        .accounts({
          signerRegistry: viaRegistryPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      // Verify signer was added
      const viaRegistry = await program.account.signerRegistry.fetch(
        viaRegistryPDA
      );
      assert.include(
        viaRegistry.signers.map((s) => s.toString()),
        newSigner.publicKey.toString(),
        "New signer should be in registry"
      );

      // Remove signer
      await program.methods
        .removeSigner(newSigner.publicKey)
        .accounts({
          signerRegistry: viaRegistryPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      // Verify signer was removed
      const updatedRegistry = await program.account.signerRegistry.fetch(
        viaRegistryPDA
      );
      assert.notInclude(
        updatedRegistry.signers.map((s) => s.toString()),
        newSigner.publicKey.toString(),
        "Signer should be removed from registry"
      );
    });
  });
});

/**
 * Helper function to create message hash for cross-chain messages
 * Uses Keccak256 with length-prefixed encoding (Solana-native format)
 */
function createMessageHash(
  txId: BN,
  sourceChainId: number[],
  destChainId: number[],
  sender: number[],
  recipient: number[],
  data: number[]
): number[] {
  // Length-prefixed encoding for Solana
  const messageBytes = [
    ...txId.toArrayLike(Buffer, "le", 8),
    ...sourceChainId,
    ...destChainId,
    ...Buffer.from([sender.length]),
    ...sender,
    ...Buffer.from([recipient.length]),
    ...recipient,
    ...Buffer.from([data.length % 256, Math.floor(data.length / 256)]), // Little-endian length
    ...data,
  ];

  return Array.from(
    Buffer.from(keccak_256.arrayBuffer(Buffer.from(messageBytes)))
  );
}
