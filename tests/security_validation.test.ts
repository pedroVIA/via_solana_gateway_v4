import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MessageGatewayV4 } from "../target/types/message_gateway_v4";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  Transaction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY
} from "@solana/web3.js";
import { assert } from "chai";
import * as nacl from "tweetnacl";
import { keccak_256 } from "js-sha3";

describe("Security Validation Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MessageGatewayV4 as Program<MessageGatewayV4>;
  
  // Test accounts
  let authority: Keypair;
  let relayer: Keypair;
  let gateway: PublicKey;
  let viaRegistry: PublicKey;
  let chainRegistry: PublicKey;
  let projectRegistry: PublicKey;

  // Test signers
  let viaSigners: Keypair[];
  let chainSigners: Keypair[];
  let projectSigners: Keypair[];

  const chainId = 1; // Solana testnet
  const sourceChainId = 2; // Ethereum

  before(async () => {
    // Initialize test accounts
    authority = Keypair.generate();
    relayer = Keypair.generate();
    
    // Fund accounts
    const fundTx = new Transaction();
    fundTx.add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: authority.publicKey,
        lamports: 10 * anchor.web3.LAMPORTS_PER_SOL,
      }),
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: relayer.publicKey,
        lamports: 10 * anchor.web3.LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx);

    // Generate test signers
    viaSigners = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    chainSigners = [Keypair.generate(), Keypair.generate()];
    projectSigners = [Keypair.generate(), Keypair.generate()];

    // Derive PDAs
    [gateway] = PublicKey.findProgramAddressSync(
      [Buffer.from("gateway"), Buffer.from(chainId.toString().padStart(8, '0'))],
      program.programId
    );

    [viaRegistry] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from([0]), // VIA registry type
        Buffer.from(chainId.toString().padStart(8, '0'))
      ],
      program.programId
    );

    [chainRegistry] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from([1]), // Chain registry type
        Buffer.from(sourceChainId.toString().padStart(8, '0'))
      ],
      program.programId
    );

    [projectRegistry] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from([2]), // Project registry type
        Buffer.from(chainId.toString().padStart(8, '0'))
      ],
      program.programId
    );

    // Initialize gateway
    await program.methods
      .initializeGateway(chainId)
      .accounts({
        gateway,
        authority: authority.publicKey,
        payer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Initialize signer registries
    await program.methods
      .initializeSignerRegistry(
        { via: {} },
        chainId,
        viaSigners.map(s => s.publicKey),
        2 // Require 2 signatures
      )
      .accounts({
        signerRegistry: viaRegistry,
        gateway,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .initializeSignerRegistry(
        { chain: {} },
        sourceChainId,
        chainSigners.map(s => s.publicKey),
        1 // Require 1 signature
      )
      .accounts({
        signerRegistry: chainRegistry,
        gateway,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .initializeSignerRegistry(
        { project: {} },
        chainId,
        projectSigners.map(s => s.publicKey),
        1 // Require 1 signature
      )
      .accounts({
        signerRegistry: projectRegistry,
        gateway,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  });

  describe("Cross-Chain Message Hash Generation", () => {
    it("should generate consistent hashes", async () => {
      const txId = 12345n;
      const sender = Buffer.from("0x1234567890123456789012345678901234567890", "hex");
      const recipient = Buffer.from("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", "hex");
      const onChainData = Buffer.from("test data");
      const offChainData = Buffer.from("");

      // Generate hash using the same algorithm as the program
      const hash1 = generateMessageHash(
        txId,
        sourceChainId,
        chainId,
        sender,
        recipient,
        onChainData,
        offChainData
      );

      const hash2 = generateMessageHash(
        txId,
        sourceChainId,
        chainId,
        sender,
        recipient,
        onChainData,
        offChainData
      );

      assert.deepEqual(hash1, hash2, "Hashes should be deterministic");
    });

    it("should produce different hashes for different inputs", async () => {
      const baseParams = {
        txId: 12345n,
        sourceChainId,
        destChainId: chainId,
        sender: Buffer.from("0x1234567890123456789012345678901234567890", "hex"),
        recipient: Buffer.from("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", "hex"),
        onChainData: Buffer.from("test data"),
        offChainData: Buffer.from("")
      };

      const hash1 = generateMessageHash(
        baseParams.txId,
        baseParams.sourceChainId,
        baseParams.destChainId,
        baseParams.sender,
        baseParams.recipient,
        baseParams.onChainData,
        baseParams.offChainData
      );

      // Different txId
      const hash2 = generateMessageHash(
        54321n,
        baseParams.sourceChainId,
        baseParams.destChainId,
        baseParams.sender,
        baseParams.recipient,
        baseParams.onChainData,
        baseParams.offChainData
      );

      // Different data
      const hash3 = generateMessageHash(
        baseParams.txId,
        baseParams.sourceChainId,
        baseParams.destChainId,
        baseParams.sender,
        baseParams.recipient,
        Buffer.from("different data"),
        baseParams.offChainData
      );

      assert.notDeepEqual(hash1, hash2, "Different txId should produce different hash");
      assert.notDeepEqual(hash1, hash3, "Different data should produce different hash");
    });
  });

  describe("Ed25519 Signature Verification", () => {
    it("should verify valid signatures", async () => {
      const message = Buffer.from("test message");
      const keypair = Keypair.generate();
      
      const signature = nacl.sign.detached(message, keypair.secretKey);
      
      // Verify with nacl (should be true)
      const isValid = nacl.sign.detached.verify(
        message,
        signature,
        keypair.publicKey.toBytes()
      );
      
      assert.isTrue(isValid, "Valid signature should verify");
    });

    it("should reject invalid signatures", async () => {
      const message = Buffer.from("test message");
      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();
      
      const signature = nacl.sign.detached(message, keypair1.secretKey);
      
      // Try to verify with wrong public key (should be false)
      const isValid = nacl.sign.detached.verify(
        message,
        signature,
        keypair2.publicKey.toBytes()
      );
      
      assert.isFalse(isValid, "Invalid signature should be rejected");
    });
  });

  describe("Signer Registry Management", () => {
    it("should update signers correctly", async () => {
      const newSigners = [Keypair.generate(), Keypair.generate()];
      
      await program.methods
        .updateSigners(
          { via: {} },
          chainId,
          newSigners.map(s => s.publicKey),
          2
        )
        .accounts({
          signerRegistry: viaRegistry,
          gateway,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const registryAccount = await program.account.signerRegistry.fetch(viaRegistry);
      assert.equal(registryAccount.signers.length, 2);
      assert.equal(registryAccount.requiredSignatures, 2);
    });

    it("should add individual signers", async () => {
      const newSigner = Keypair.generate();
      
      await program.methods
        .addSigner({ via: {} }, chainId, newSigner.publicKey)
        .accounts({
          signerRegistry: viaRegistry,
          gateway,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const registryAccount = await program.account.signerRegistry.fetch(viaRegistry);
      assert.isTrue(
        registryAccount.signers.some(s => s.equals(newSigner.publicKey)),
        "New signer should be added"
      );
    });

    it("should remove signers", async () => {
      const registryBefore = await program.account.signerRegistry.fetch(viaRegistry);
      const signerToRemove = registryBefore.signers[0];
      
      await program.methods
        .removeSigner({ via: {} }, chainId, signerToRemove)
        .accounts({
          signerRegistry: viaRegistry,
          gateway,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const registryAfter = await program.account.signerRegistry.fetch(viaRegistry);
      assert.isFalse(
        registryAfter.signers.some(s => s.equals(signerToRemove)),
        "Signer should be removed"
      );
    });

    it("should update thresholds", async () => {
      await program.methods
        .updateThreshold({ via: {} }, chainId, 1)
        .accounts({
          signerRegistry: viaRegistry,
          gateway,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const registryAccount = await program.account.signerRegistry.fetch(viaRegistry);
      assert.equal(registryAccount.requiredSignatures, 1);
    });

    it("should enable/disable registries", async () => {
      await program.methods
        .setRegistryEnabled({ via: {} }, chainId, false)
        .accounts({
          signerRegistry: viaRegistry,
          gateway,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      let registryAccount = await program.account.signerRegistry.fetch(viaRegistry);
      assert.isFalse(registryAccount.enabled, "Registry should be disabled");

      await program.methods
        .setRegistryEnabled({ via: {} }, chainId, true)
        .accounts({
          signerRegistry: viaRegistry,
          gateway,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      registryAccount = await program.account.signerRegistry.fetch(viaRegistry);
      assert.isTrue(registryAccount.enabled, "Registry should be enabled");
    });
  });

  describe("Three-Layer Signature Validation Integration", () => {
    it("should successfully process message with valid signatures", async () => {
      const txId = 98765n;
      const sender = Buffer.from("0x1234567890123456789012345678901234567890", "hex");
      const recipient = Buffer.from(relayer.publicKey.toBytes());
      const onChainData = Buffer.from("integration test data");
      const offChainData = Buffer.from("");

      // Create message hash
      const messageHash = generateMessageHash(
        txId,
        sourceChainId,
        chainId,
        sender,
        recipient,
        onChainData,
        offChainData
      );

      // Create signatures from each layer
      const viaSignature1 = nacl.sign.detached(messageHash, viaSigners[0].secretKey);
      const chainSignature1 = nacl.sign.detached(messageHash, chainSigners[0].secretKey);
      const projectSignature1 = nacl.sign.detached(messageHash, projectSigners[0].secretKey);

      const signatures = [
        {
          signature: Array.from(viaSignature1),
          signer: viaSigners[0].publicKey,
          layer: { via: {} }
        },
        {
          signature: Array.from(chainSignature1),
          signer: chainSigners[0].publicKey,
          layer: { chain: {} }
        },
        {
          signature: Array.from(projectSignature1),
          signer: projectSigners[0].publicKey,
          layer: { project: {} }
        }
      ];

      // Derive TxId PDA
      const [txIdPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("tx"),
          Buffer.from(sourceChainId.toString().padStart(8, '0')),
          Buffer.from(txId.toString().padStart(16, '0'))
        ],
        program.programId
      );

      // Create Ed25519 verification instructions for each signature
      const ed25519Ixs = signatures.map(sig => 
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: sig.signer.toBytes(),
          message: messageHash,
          signature: Buffer.from(sig.signature),
        })
      );

      // TX1: Create TxId PDA
      const tx1 = new Transaction();
      tx1.add(...ed25519Ixs);
      tx1.add(
        await program.methods
          .createTxPda(
            txId,
            sourceChainId,
            chainId,
            Array.from(sender),
            Array.from(recipient),
            Array.from(onChainData),
            Array.from(offChainData),
            signatures
          )
          .accounts({
            txIdPda,
            counterPda: PublicKey.findProgramAddressSync(
              [Buffer.from("counter"), Buffer.from(sourceChainId.toString().padStart(8, '0'))],
              program.programId
            )[0],
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      await provider.sendAndConfirm(tx1, [relayer]);

      // TX2: Process message with signature validation
      const tx2 = new Transaction();
      tx2.add(...ed25519Ixs);
      tx2.add(
        await program.methods
          .processMessage(
            txId,
            sourceChainId,
            chainId,
            Array.from(sender),
            Array.from(recipient),
            Array.from(onChainData),
            Array.from(offChainData),
            signatures
          )
          .accounts({
            gateway,
            txIdPda,
            viaRegistry,
            chainRegistry,
            projectRegistry,
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      const txSig = await provider.sendAndConfirm(tx2, [relayer]);
      assert.isOk(txSig, "Transaction should succeed with valid signatures");
    });

    it("should reject message with insufficient signatures", async () => {
      const txId = 11111n;
      const sender = Buffer.from("0x1234567890123456789012345678901234567890", "hex");
      const recipient = Buffer.from(relayer.publicKey.toBytes());
      const onChainData = Buffer.from("insufficient sigs test");
      const offChainData = Buffer.from("");

      const messageHash = generateMessageHash(
        txId,
        sourceChainId,
        chainId,
        sender,
        recipient,
        onChainData,
        offChainData
      );

      // Only provide chain signature, missing VIA and project signatures
      const chainSignature = nacl.sign.detached(messageHash, chainSigners[0].secretKey);

      const signatures = [
        {
          signature: Array.from(chainSignature),
          signer: chainSigners[0].publicKey,
          layer: { chain: {} }
        }
      ];

      const [txIdPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("tx"),
          Buffer.from(sourceChainId.toString().padStart(8, '0')),
          Buffer.from(txId.toString().padStart(16, '0'))
        ],
        program.programId
      );

      // TX1: Create TxId PDA (should succeed)
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: chainSigners[0].publicKey.toBytes(),
        message: messageHash,
        signature: Buffer.from(chainSignature),
      });

      const tx1 = new Transaction();
      tx1.add(ed25519Ix);
      tx1.add(
        await program.methods
          .createTxPda(
            txId,
            sourceChainId,
            chainId,
            Array.from(sender),
            Array.from(recipient),
            Array.from(onChainData),
            Array.from(offChainData),
            signatures
          )
          .accounts({
            txIdPda,
            counterPda: PublicKey.findProgramAddressSync(
              [Buffer.from("counter"), Buffer.from(sourceChainId.toString().padStart(8, '0'))],
              program.programId
            )[0],
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      await provider.sendAndConfirm(tx1, [relayer]);

      // TX2: Process message (should fail due to insufficient signatures)
      const tx2 = new Transaction();
      tx2.add(ed25519Ix);
      tx2.add(
        await program.methods
          .processMessage(
            txId,
            sourceChainId,
            chainId,
            Array.from(sender),
            Array.from(recipient),
            Array.from(onChainData),
            Array.from(offChainData),
            signatures
          )
          .accounts({
            gateway,
            txIdPda,
            viaRegistry,
            chainRegistry,
            projectRegistry,
            relayer: relayer.publicKey,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      try {
        await provider.sendAndConfirm(tx2, [relayer]);
        assert.fail("Should have failed due to insufficient VIA signatures");
      } catch (error) {
        assert.include(error.message, "InsufficientVIASignatures");
      }
    });
  });

  // Helper function to generate message hash (matches program implementation)
  function generateMessageHash(
    txId: bigint,
    sourceChainId: number,
    destChainId: number,
    sender: Buffer,
    recipient: Buffer,
    onChainData: Buffer,
    offChainData: Buffer
  ): Buffer {
    const encoded = Buffer.concat([
      // u128 tx_id (16 bytes, little endian)
      Buffer.from(txId.toString(16).padStart(32, '0'), 'hex').reverse(),
      
      // u64 source_chain_id (8 bytes, little endian)
      Buffer.from(sourceChainId.toString(16).padStart(16, '0'), 'hex').reverse(),
      
      // u64 dest_chain_id (8 bytes, little endian)  
      Buffer.from(destChainId.toString(16).padStart(16, '0'), 'hex').reverse(),
      
      // Length-prefixed data
      encodeLengthPrefixed(sender),
      encodeLengthPrefixed(recipient),
      encodeLengthPrefixed(onChainData),
      encodeLengthPrefixed(offChainData),
    ]);

    return Buffer.from(keccak_256.array(encoded));
  }

  function encodeLengthPrefixed(data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(data.length, 0);
    return Buffer.concat([length, data]);
  }
});