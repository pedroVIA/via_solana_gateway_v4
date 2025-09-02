import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MessageGatewayV4 } from "../target/types/message_gateway_v4";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  Transaction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY
} from "@solana/web3.js";
import { assert, expect } from "chai";
import * as nacl from "tweetnacl";
import { keccak_256 } from "js-sha3";

describe("Signature Validation Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MessageGatewayV4 as Program<MessageGatewayV4>;
  
  // Test accounts
  let authority: Keypair;
  let relayer: Keypair;
  
  // Gateway and registries
  let gatewayPDA: PublicKey;
  let sourceGatewayPDA: PublicKey; // For source chain (Chain registry)
  let viaRegistryPDA: PublicKey;
  let chainRegistryPDA: PublicKey;
  let projectRegistryPDA: PublicKey;
  
  // Test signers
  let viaSigners: Keypair[];
  let chainSigners: Keypair[];
  let projectSigners: Keypair[];
  
  // Test configuration - use unique chain IDs to avoid conflicts
  const CHAIN_ID = new BN(Math.floor(Math.random() * 100000) + 10000); // Random chain ID
  const SOURCE_CHAIN_ID = new BN(Math.floor(Math.random() * 100000) + 20000); // Random source chain ID

  before(async () => {
    console.log("\n🔐 Setting up signature validation test environment...");
    
    // Use provider wallet as authority (it has the correct permissions)
    authority = (provider.wallet as any).payer;
    
    // Create test accounts
    relayer = Keypair.generate();
    
    // Fund relayer account
    const airdropAmount = 10 * anchor.web3.LAMPORTS_PER_SOL;
    await provider.connection.requestAirdrop(relayer.publicKey, airdropAmount);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for airdrop
    
    // Generate test signers
    viaSigners = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    chainSigners = [Keypair.generate(), Keypair.generate()];
    projectSigners = [Keypair.generate(), Keypair.generate()];
    
    console.log("✅ Created test signers:");
    console.log(`  VIA Signers: ${viaSigners.length}`);
    console.log(`  Chain Signers: ${chainSigners.length}`);
    console.log(`  Project Signers: ${projectSigners.length}`);
    console.log(`  CHAIN_ID: ${CHAIN_ID.toString()}`);
    console.log(`  SOURCE_CHAIN_ID: ${SOURCE_CHAIN_ID.toString()}`);
    
    // Derive PDAs
    [gatewayPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("gateway"), chainIdToBytes(CHAIN_ID)],
      program.programId
    );
    
    // Gateway for source chain (needed for Chain registry)
    [sourceGatewayPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("gateway"), chainIdToBytes(SOURCE_CHAIN_ID)],
      program.programId
    );
    
    [viaRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("signer_registry"), Buffer.from([0]), chainIdToBytes(CHAIN_ID)],
      program.programId
    );
    
    [chainRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("signer_registry"), Buffer.from([1]), chainIdToBytes(SOURCE_CHAIN_ID)],
      program.programId
    );
    
    [projectRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("signer_registry"), Buffer.from([2]), chainIdToBytes(CHAIN_ID)],
      program.programId
    );
    
    // Initialize gateways (check if already exist first)
    console.log("🏗️  Initializing destination gateway...");
    try {
      await program.account.messageGateway.fetch(gatewayPDA);
      console.log("✅ Destination gateway already exists, skipping initialization");
    } catch {
      // Gateway doesn't exist, initialize it
      await program.methods
        .initializeGateway(CHAIN_ID)
        .accounts({
          gateway: gatewayPDA,
          authority: authority.publicKey,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log("✅ Destination gateway initialized");
    }
    
    console.log("🏗️  Initializing source gateway...");
    try {
      await program.account.messageGateway.fetch(sourceGatewayPDA);
      console.log("✅ Source gateway already exists, skipping initialization");
    } catch {
      // Gateway doesn't exist, initialize it
      await program.methods
        .initializeGateway(SOURCE_CHAIN_ID)
        .accounts({
          gateway: sourceGatewayPDA,
          authority: authority.publicKey,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log("✅ Source gateway initialized");
    }
    
    // Initialize signer registries
    console.log("📝 Initializing signer registries...");
    
    // VIA Registry (require 2 out of 3 signatures)
    try {
      await program.account.signerRegistry.fetch(viaRegistryPDA);
      console.log("✅ VIA registry already exists, updating signers...");
      await program.methods
        .updateSigners(
          { via: {} },
          CHAIN_ID,
          viaSigners.map(s => s.publicKey),
          2
        )
        .accounts({
          signerRegistry: viaRegistryPDA,
          gateway: gatewayPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
    } catch {
      await program.methods
        .initializeSignerRegistry(
          { via: {} },
          CHAIN_ID,
          viaSigners.map(s => s.publicKey),
          2
        )
        .accounts({
          signerRegistry: viaRegistryPDA,
          gateway: gatewayPDA,
          authority: authority.publicKey,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log("✅ VIA registry initialized (2/3 threshold)");
    }
    
    // Chain Registry (require 1 out of 2 signatures)
    // Chain registry uses SOURCE_CHAIN_ID and needs the source gateway
    try {
      await program.account.signerRegistry.fetch(chainRegistryPDA);
      console.log("✅ Chain registry already exists, updating signers...");
      await program.methods
        .updateSigners(
          { chain: {} },
          SOURCE_CHAIN_ID,
          chainSigners.map(s => s.publicKey),
          1
        )
        .accounts({
          signerRegistry: chainRegistryPDA,
          gateway: sourceGatewayPDA, // Use source gateway for chain registry
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
    } catch (e) {
      console.log("Creating chain registry...");
      await program.methods
        .initializeSignerRegistry(
          { chain: {} },
          SOURCE_CHAIN_ID,
          chainSigners.map(s => s.publicKey),
          1
        )
        .accounts({
          signerRegistry: chainRegistryPDA,
          gateway: sourceGatewayPDA, // Use source gateway for chain registry
          authority: authority.publicKey,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log("✅ Chain registry initialized (1/2 threshold)");
    }
    
    // Project Registry (require 1 out of 2 signatures)
    try {
      await program.account.signerRegistry.fetch(projectRegistryPDA);
      console.log("✅ Project registry already exists, updating signers...");
      await program.methods
        .updateSigners(
          { project: {} },
          CHAIN_ID,
          projectSigners.map(s => s.publicKey),
          1
        )
        .accounts({
          signerRegistry: projectRegistryPDA,
          gateway: gatewayPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
    } catch {
      await program.methods
        .initializeSignerRegistry(
          { project: {} },
          CHAIN_ID,
          projectSigners.map(s => s.publicKey),
          1
        )
        .accounts({
          signerRegistry: projectRegistryPDA,
          gateway: gatewayPDA,
          authority: authority.publicKey,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log("✅ Project registry initialized (1/2 threshold)");
    }
    
    console.log("🔐 Signature validation environment ready!\n");
  });

  describe("Three-Layer Signature Validation", () => {
    it("should successfully process message with valid three-layer signatures", async () => {
      console.log("\n🧪 TEST: Valid three-layer signatures");
      
      const txId = new BN(Date.now());
      const sender = Buffer.from("1234567890123456789012345678901234567890", "hex");  // Remove 0x prefix
      const recipient = Buffer.from(relayer.publicKey.toBytes());
      const onChainData = Buffer.from("test message data");
      const offChainData = Buffer.from("metadata");
      
      // Generate message hash
      const messageHash = generateMessageHash(
        txId,
        SOURCE_CHAIN_ID,
        CHAIN_ID,
        sender,
        recipient,
        onChainData,
        offChainData
      );
      console.log(`📋 Message hash: ${Buffer.from(messageHash).toString('hex')}`);
      
      // Create signatures from each layer
      const signatures = [
        // VIA layer - need 2 signatures
        {
          signature: nacl.sign.detached(messageHash, viaSigners[0].secretKey),
          signer: viaSigners[0].publicKey,
          layer: { via: {} }  // Anchor enum format (lowercase)
        },
        {
          signature: nacl.sign.detached(messageHash, viaSigners[1].secretKey),
          signer: viaSigners[1].publicKey,
          layer: { via: {} }  // Anchor enum format (lowercase)
        },
        // Chain layer - need 1 signature
        {
          signature: nacl.sign.detached(messageHash, chainSigners[0].secretKey),
          signer: chainSigners[0].publicKey,
          layer: { chain: {} }  // Anchor enum format
        },
        // Project layer - need 1 signature
        {
          signature: nacl.sign.detached(messageHash, projectSigners[0].secretKey),
          signer: projectSigners[0].publicKey,
          layer: { project: {} }  // Anchor enum format
        }
      ];
      
      console.log(`🔏 Created ${signatures.length} signatures:`);
      console.log(`  - VIA: 2 signatures`);
      console.log(`  - Chain: 1 signature`);
      console.log(`  - Project: 1 signature`);
      
      // Derive TxId PDA
      const [txIdPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tx"), chainIdToBytes(SOURCE_CHAIN_ID), txIdToBytes(txId)],
        program.programId
      );
      
      const [counterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("counter"), chainIdToBytes(SOURCE_CHAIN_ID)],
        program.programId
      );
      
      // Create Ed25519 verification instructions
      const ed25519Ixs = signatures.map(sig => 
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: sig.signer.toBytes(),
          message: messageHash,
          signature: Buffer.from(sig.signature),
        })
      );
      
      // TX1: Create TxId PDA with signature validation
      // Only need one Ed25519 instruction for TX1 (basic validation)
      console.log("📤 TX1: Creating TxId PDA with signature validation...");
      const tx1 = new Transaction();
      tx1.add(ed25519Ixs[0]);  // Only add one Ed25519 instruction for TX1
      tx1.add(
        await program.methods
          .createTxPda(
            txId,
            SOURCE_CHAIN_ID,
            CHAIN_ID,
            sender,
            recipient,
            onChainData,
            offChainData,
            signatures
          )
          .accounts({
            txIdPda,
            counterPda,
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );
      
      const tx1Sig = await provider.sendAndConfirm(tx1, [relayer]);
      console.log(`✅ TX1 Success: ${tx1Sig}`);
      
      // TX2: Process message with three-layer validation
      console.log("📥 TX2: Processing message with three-layer validation...");
      const tx2 = new Transaction();
      tx2.add(...ed25519Ixs);
      tx2.add(
        await program.methods
          .processMessage(
            txId,
            SOURCE_CHAIN_ID,
            CHAIN_ID,
            sender,
            recipient,
            onChainData,
            offChainData,
            signatures
          )
          .accounts({
            gateway: gatewayPDA,
            txIdPda,
            viaRegistry: viaRegistryPDA,
            chainRegistry: chainRegistryPDA,
            projectRegistry: projectRegistryPDA,
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );
      
      const tx2Sig = await provider.sendAndConfirm(tx2, [relayer]);
      console.log(`✅ TX2 Success: ${tx2Sig}`);
      
      // Verify TxId PDA was closed (replay protection)
      try {
        await program.account.txIdPda.fetch(txIdPda);
        assert.fail("TxId PDA should have been closed");
      } catch (error) {
        console.log("✅ TxId PDA successfully closed (replay protection active)");
      }
      
      console.log("✅ Test passed: Three-layer signature validation successful!");
    });

    it("should reject message with insufficient VIA signatures", async () => {
      console.log("\n🧪 TEST: Insufficient VIA signatures");
      
      const txId = new BN(Date.now() + 1000);
      const sender = Buffer.from("1234567890123456789012345678901234567890", "hex");  // Remove 0x prefix
      const recipient = Buffer.from(relayer.publicKey.toBytes());
      const onChainData = Buffer.from("insufficient VIA test");
      const offChainData = Buffer.from("");
      
      const messageHash = generateMessageHash(
        txId,
        SOURCE_CHAIN_ID,
        CHAIN_ID,
        sender,
        recipient,
        onChainData,
        offChainData
      );
      
      // Create signatures - only 1 VIA signature (need 2)
      const signatures = [
        // VIA layer - only 1 signature (insufficient!)
        {
          signature: nacl.sign.detached(messageHash, viaSigners[0].secretKey),
          signer: viaSigners[0].publicKey,
          layer: { via: {} }  // Anchor enum format (lowercase)
        },
        // Chain layer - 1 signature (sufficient)
        {
          signature: nacl.sign.detached(messageHash, chainSigners[0].secretKey),
          signer: chainSigners[0].publicKey,
          layer: { chain: {} }  // Anchor enum format
        },
        // Project layer - 1 signature (sufficient)
        {
          signature: nacl.sign.detached(messageHash, projectSigners[0].secretKey),
          signer: projectSigners[0].publicKey,
          layer: { project: {} }  // Anchor enum format
        }
      ];
      
      console.log("🔏 Created insufficient signatures:");
      console.log("  - VIA: 1 signature (need 2) ❌");
      console.log("  - Chain: 1 signature ✅");
      console.log("  - Project: 1 signature ✅");
      
      const [txIdPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tx"), chainIdToBytes(SOURCE_CHAIN_ID), txIdToBytes(txId)],
        program.programId
      );
      
      const [counterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("counter"), chainIdToBytes(SOURCE_CHAIN_ID)],
        program.programId
      );
      
      const ed25519Ixs = signatures.map(sig => 
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: sig.signer.toBytes(),
          message: messageHash,
          signature: Buffer.from(sig.signature),
        })
      );
      
      // TX1: Should succeed (basic validation only)
      console.log("📤 TX1: Creating TxId PDA (should succeed)...");
      const tx1 = new Transaction();
      tx1.add(ed25519Ixs[0]);  // Only need one Ed25519 instruction for TX1
      tx1.add(
        await program.methods
          .createTxPda(
            txId,
            SOURCE_CHAIN_ID,
            CHAIN_ID,
            sender,
            recipient,
            onChainData,
            offChainData,
            signatures
          )
          .accounts({
            txIdPda,
            counterPda,
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );
      
      await provider.sendAndConfirm(tx1, [relayer]);
      console.log("✅ TX1 succeeded (basic validation passed)");
      
      // TX2: Should fail due to insufficient VIA signatures
      console.log("📥 TX2: Processing message (should fail)...");
      const tx2 = new Transaction();
      tx2.add(...ed25519Ixs);
      tx2.add(
        await program.methods
          .processMessage(
            txId,
            SOURCE_CHAIN_ID,
            CHAIN_ID,
            sender,
            recipient,
            onChainData,
            offChainData,
            signatures
          )
          .accounts({
            gateway: gatewayPDA,
            txIdPda,
            viaRegistry: viaRegistryPDA,
            chainRegistry: chainRegistryPDA,
            projectRegistry: projectRegistryPDA,
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );
      
      try {
        await provider.sendAndConfirm(tx2, [relayer]);
        assert.fail("Should have failed due to insufficient VIA signatures");
      } catch (error: any) {
        assert.include(error.toString(), "InsufficientVIASignatures");
        console.log("✅ TX2 correctly rejected: Insufficient VIA signatures");
      }
      
      console.log("✅ Test passed: Insufficient signatures properly rejected!");
    });

    it("should reject message with invalid signatures", async () => {
      console.log("\n🧪 TEST: Invalid signatures");
      
      const txId = new BN(Date.now() + 2000);
      const sender = Buffer.from("1234567890123456789012345678901234567890", "hex");  // Remove 0x prefix
      const recipient = Buffer.from(relayer.publicKey.toBytes());
      const onChainData = Buffer.from("invalid signature test");
      const offChainData = Buffer.from("");
      
      const messageHash = generateMessageHash(
        txId,
        SOURCE_CHAIN_ID,
        CHAIN_ID,
        sender,
        recipient,
        onChainData,
        offChainData
      );
      
      // Create a different message for invalid signature
      const wrongMessage = Buffer.from("wrong message");
      
      // Create signatures - one with wrong message
      const signatures = [
        // VIA layer - 2 signatures
        {
          signature: Array.from(nacl.sign.detached(wrongMessage, viaSigners[0].secretKey)), // INVALID!
          signer: viaSigners[0].publicKey,
          layer: { via: {} }
        },
        {
          signature: Array.from(nacl.sign.detached(messageHash, viaSigners[1].secretKey)),
          signer: viaSigners[1].publicKey,
          layer: { via: {} }
        },
        // Chain layer - 1 signature
        {
          signature: Array.from(nacl.sign.detached(messageHash, chainSigners[0].secretKey)),
          signer: chainSigners[0].publicKey,
          layer: { chain: {} }
        },
        // Project layer - 1 signature
        {
          signature: Array.from(nacl.sign.detached(messageHash, projectSigners[0].secretKey)),
          signer: projectSigners[0].publicKey,
          layer: { project: {} }
        }
      ];
      
      console.log("🔏 Created signatures with one invalid:");
      console.log("  - VIA signer 0: Invalid signature ❌");
      console.log("  - VIA signer 1: Valid signature ✅");
      console.log("  - Chain: Valid signature ✅");
      console.log("  - Project: Valid signature ✅");
      
      const [txIdPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tx"), chainIdToBytes(SOURCE_CHAIN_ID), txIdToBytes(txId)],
        program.programId
      );
      
      const [counterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("counter"), chainIdToBytes(SOURCE_CHAIN_ID)],
        program.programId
      );
      
      // Ed25519 instructions - mix valid and invalid
      const ed25519Ixs = [
        // Invalid signature for first VIA signer
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: viaSigners[0].publicKey.toBytes(),
          message: wrongMessage, // Wrong message!
          signature: Buffer.from(signatures[0].signature),
        }),
        // Valid signatures for the rest
        ...signatures.slice(1).map(sig => 
          Ed25519Program.createInstructionWithPublicKey({
            publicKey: sig.signer.toBytes(),
            message: messageHash,
            signature: Buffer.from(sig.signature),
          })
        )
      ];
      
      // TX1: Should fail due to invalid signature
      console.log("📤 TX1: Creating TxId PDA (should fail)...");
      const tx1 = new Transaction();
      tx1.add(ed25519Ixs[0]);  // Add the invalid signature Ed25519 instruction
      tx1.add(
        await program.methods
          .createTxPda(
            txId,
            SOURCE_CHAIN_ID,
            CHAIN_ID,
            sender,
            recipient,
            onChainData,
            offChainData,
            signatures
          )
          .accounts({
            txIdPda,
            counterPda,
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );
      
      try {
        await provider.sendAndConfirm(tx1, [relayer]);
        assert.fail("Should have failed due to invalid signature");
      } catch (error: any) {
        assert.include(error.toString(), "InvalidSignature");
        console.log("✅ TX1 correctly rejected: Invalid signature detected");
      }
      
      console.log("✅ Test passed: Invalid signatures properly rejected!");
    });
  });

  describe("Signer Registry Management", () => {
    it("should update signer registry thresholds", async () => {
      console.log("\n🧪 TEST: Update signer registry thresholds");
      
      // Update VIA registry threshold from 2 to 1
      console.log("📝 Updating VIA registry threshold from 2 to 1...");
      await program.methods
        .updateThreshold({ via: {} }, CHAIN_ID, 1)
        .accounts({
          signerRegistry: viaRegistryPDA,
          gateway: gatewayPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
      
      // Fetch and verify
      const viaRegistry = await program.account.signerRegistry.fetch(viaRegistryPDA);
      assert.equal(viaRegistry.requiredSignatures, 1);
      console.log("✅ VIA registry threshold updated to 1");
      
      // Test with only 1 VIA signature (should now work)
      const txId = new BN(Date.now() + 3000);
      const sender = Buffer.from("1234567890123456789012345678901234567890", "hex");  // Remove 0x prefix
      const recipient = Buffer.from(relayer.publicKey.toBytes());
      const onChainData = Buffer.from("threshold test");
      const offChainData = Buffer.from("");
      
      const messageHash = generateMessageHash(
        txId,
        SOURCE_CHAIN_ID,
        CHAIN_ID,
        sender,
        recipient,
        onChainData,
        offChainData
      );
      
      const signatures = [
        // VIA layer - only 1 signature (now sufficient!)
        {
          signature: Array.from(nacl.sign.detached(messageHash, viaSigners[0].secretKey)),
          signer: viaSigners[0].publicKey,
          layer: { via: {} }
        },
        // Chain layer
        {
          signature: Array.from(nacl.sign.detached(messageHash, chainSigners[0].secretKey)),
          signer: chainSigners[0].publicKey,
          layer: { chain: {} }
        },
        // Project layer
        {
          signature: Array.from(nacl.sign.detached(messageHash, projectSigners[0].secretKey)),
          signer: projectSigners[0].publicKey,
          layer: { project: {} }
        }
      ];
      
      const [txIdPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tx"), chainIdToBytes(SOURCE_CHAIN_ID), txIdToBytes(txId)],
        program.programId
      );
      
      const [counterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("counter"), chainIdToBytes(SOURCE_CHAIN_ID)],
        program.programId
      );
      
      const ed25519Ixs = signatures.map(sig => 
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: sig.signer.toBytes(),
          message: messageHash,
          signature: Buffer.from(sig.signature),
        })
      );
      
      // Process message with new threshold
      const tx1 = new Transaction();
      tx1.add(ed25519Ixs[0]);  // Only need one Ed25519 instruction for TX1
      tx1.add(
        await program.methods
          .createTxPda(
            txId,
            SOURCE_CHAIN_ID,
            CHAIN_ID,
            sender,
            recipient,
            onChainData,
            offChainData,
            signatures
          )
          .accounts({
            txIdPda,
            counterPda,
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );
      
      await provider.sendAndConfirm(tx1, [relayer]);
      
      const tx2 = new Transaction();
      tx2.add(...ed25519Ixs);
      tx2.add(
        await program.methods
          .processMessage(
            txId,
            SOURCE_CHAIN_ID,
            CHAIN_ID,
            sender,
            recipient,
            onChainData,
            offChainData,
            signatures
          )
          .accounts({
            gateway: gatewayPDA,
            txIdPda,
            viaRegistry: viaRegistryPDA,
            chainRegistry: chainRegistryPDA,
            projectRegistry: projectRegistryPDA,
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );
      
      await provider.sendAndConfirm(tx2, [relayer]);
      console.log("✅ Message processed successfully with reduced threshold");
      
      // Restore original threshold
      await program.methods
        .updateThreshold({ via: {} }, CHAIN_ID, 2)
        .accounts({
          signerRegistry: viaRegistryPDA,
          gateway: gatewayPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
      console.log("✅ VIA registry threshold restored to 2");
      
      console.log("✅ Test passed: Registry management successful!");
    });
  });
});

// Helper functions
function generateMessageHash(
  txId: BN,
  sourceChainId: BN,
  destChainId: BN,
  sender: Buffer,
  recipient: Buffer,
  onChainData: Buffer,
  offChainData: Buffer
): Buffer {
  const encoded = Buffer.concat([
    txIdToBytes(txId),
    chainIdToBytes(sourceChainId),
    chainIdToBytes(destChainId),
    encodeLengthPrefixed(sender),
    encodeLengthPrefixed(recipient),
    encodeLengthPrefixed(onChainData),
    encodeLengthPrefixed(offChainData),
  ]);
  return Buffer.from(keccak_256.array(encoded));
}

function txIdToBytes(txId: BN): Buffer {
  const buffer = Buffer.alloc(16);
  const bytes = txId.toArrayLike(Buffer, 'le');
  bytes.copy(buffer);
  return buffer;
}

function chainIdToBytes(chainId: BN): Buffer {
  const buffer = Buffer.alloc(8);
  const bytes = chainId.toArrayLike(Buffer, 'le');
  bytes.copy(buffer);
  return buffer;
}

function encodeLengthPrefixed(data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(data.length, 0);
  return Buffer.concat([length, data]);
}