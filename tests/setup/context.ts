import { BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { MessageGatewayV4 } from "../../target/types/message_gateway_v4";
import {
  deriveGatewayPDA,
  deriveTxIdPDA,
  deriveCounterPDA,
  fundAccount,
  createFundedKeypair,
  wait,
  logInfo,
} from "./helpers";
import { createValidSignature } from "./signature";
import { TEST_CONFIG, CHAIN_IDS, WAIT_TIMES } from "./constants";

/**
 * TestContext manages the test environment and provides utilities for testing
 */
export class TestContext {
  public program: Program<MessageGatewayV4>;
  public provider: AnchorProvider;
  public connection: Connection;

  // Keypairs
  public authority: Keypair | null = null;
  public relayer: Keypair | null = null;
  public unauthorizedUser: Keypair | null = null;

  // PDAs
  public gatewayPDA: PublicKey | null = null;
  public gatewayBump: number | null = null;

  // Configuration
  public chainId: BN;
  public isInitialized: boolean = false;

  // Metrics
  public metrics: {
    totalComputeUnits: number;
    transactionCount: number;
    startTime: number;
  } = {
    totalComputeUnits: 0,
    transactionCount: 0,
    startTime: 0,
  };

  constructor(chainId?: BN) {
    // Set up Anchor provider
    this.provider = AnchorProvider.env();
    anchor.setProvider(this.provider);

    // Get program and connection
    this.program = anchor.workspace
      .MessageGatewayV4 as Program<MessageGatewayV4>;
    this.connection = this.provider.connection;

    // Use a unique chain ID for each test context if not provided
    this.chainId =
      chainId || new BN(Math.floor(Math.random() * 1000000) + 1000);

    // Derive gateway PDA
    const [pda, bump] = deriveGatewayPDA(this.program.programId, this.chainId);
    this.gatewayPDA = pda;
    this.gatewayBump = bump;
  }

  /**
   * Initialize test context with funded accounts
   */
  async setup(options?: {
    skipGatewayInit?: boolean;
    customAuthority?: Keypair;
    customRelayer?: Keypair;
    silent?: boolean;
  }): Promise<void> {
    if (!options?.silent) {
      console.log("\n📋 Setting up test context...");
    }
    this.metrics.startTime = Date.now();

    // Create and fund test accounts
    this.authority =
      options?.customAuthority ||
      (await createFundedKeypair(this.connection, TEST_CONFIG.AIRDROP_AMOUNT));

    this.relayer =
      options?.customRelayer ||
      (await createFundedKeypair(this.connection, TEST_CONFIG.AIRDROP_AMOUNT));

    this.unauthorizedUser = await createFundedKeypair(
      this.connection,
      TEST_CONFIG.AIRDROP_AMOUNT
    );

    // Wait for airdrops to confirm
    await wait(WAIT_TIMES.AIRDROP);

    if (!options?.silent) {
      logInfo("Authority", this.authority.publicKey.toString());
      logInfo("Relayer", this.relayer.publicKey.toString());
      logInfo("Gateway PDA", this.gatewayPDA!.toString());
      logInfo("Chain ID", this.chainId.toString());
    }

    // Initialize gateway unless skipped
    if (!options?.skipGatewayInit) {
      await this.initializeGateway();
    }

    // Setup signer registries for test:u3 compatibility
    if (!options?.silent) {
      await this.setupTestSignerRegistries();
    }

    this.isInitialized = true;
    if (!options?.silent) {
      console.log("✅ Test context ready");
    }
  }

  /**
   * Show context information (for use after test headers)
   */
  showContext(): void {
    console.log("📋 Test Context:");
    logInfo("Authority", this.authority!.publicKey.toString());
    logInfo("Relayer", this.relayer!.publicKey.toString());
    logInfo("Gateway PDA", this.gatewayPDA!.toString());
    logInfo("Chain ID", this.chainId.toString());
  }

  /**
   * Initialize the gateway
   */
  async initializeGateway(): Promise<string> {
    if (!this.authority || !this.gatewayPDA) {
      throw new Error("Context not properly setup");
    }

    const tx = await this.program.methods
      .initializeGateway(this.chainId)
      .accounts({
        gateway: this.gatewayPDA,
        authority: this.authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authority])
      .rpc();

    this.metrics.transactionCount++;
    logInfo("Gateway initialized", tx);
    return tx;
  }

  /**
   * Clean up test context
   */
  async teardown(): Promise<void> {
    if (!this.isInitialized) return;

    const elapsed = Date.now() - this.metrics.startTime;
    console.log("\n📊 Test Metrics:");
    logInfo("Total transactions", this.metrics.transactionCount);
    logInfo(
      "Total compute units",
      this.metrics.totalComputeUnits.toLocaleString()
    );
    logInfo("Elapsed time", `${elapsed}ms`);

    if (this.metrics.transactionCount > 0) {
      logInfo(
        "Avg CU per transaction",
        Math.round(
          this.metrics.totalComputeUnits / this.metrics.transactionCount
        ).toLocaleString()
      );
    }

    this.isInitialized = false;
  }

  /**
   * Get gateway account data
   */
  async getGateway() {
    if (!this.gatewayPDA) {
      throw new Error("Gateway PDA not initialized");
    }
    return await this.program.account.messageGateway.fetch(this.gatewayPDA);
  }

  /**
   * Get TxId PDA account data
   */
  async getTxIdPDA(sourceChainId: BN, txId: BN) {
    const [pda] = deriveTxIdPDA(this.program.programId, sourceChainId, txId);
    return await this.program.account.txIdPda.fetch(pda);
  }

  /**
   * Get Counter PDA account data
   */
  async getCounterPDA(sourceChainId: BN) {
    try {
      const [pda] = deriveCounterPDA(this.program.programId, sourceChainId);
      return await this.program.account.counterPda.fetch(pda);
    } catch (error) {
      // Counter PDA doesn't exist yet, return null to indicate it doesn't exist
      return null;
    }
  }

  /**
   * Check if a Counter PDA exists
   */
  async counterPDAExists(sourceChainId: BN): Promise<boolean> {
    try {
      const [pda] = deriveCounterPDA(this.program.programId, sourceChainId);
      await this.program.account.counterPda.fetch(pda);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a TxId PDA exists
   */
  async txIdPDAExists(sourceChainId: BN, txId: BN): Promise<boolean> {
    try {
      const [pda] = deriveTxIdPDA(this.program.programId, sourceChainId, txId);
      await this.program.account.txIdPda.fetch(pda);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a message (helper method)
   */
  async sendMessage(
    txId: BN,
    recipient: Buffer,
    destChainId: BN,
    chainData: Buffer,
    confirmations: number = TEST_CONFIG.DEFAULT_CONFIRMATIONS
  ): Promise<string> {
    if (!this.authority || !this.gatewayPDA) {
      throw new Error("Context not properly setup");
    }

    const tx = await this.program.methods
      .sendMessage(txId, recipient, destChainId, chainData, confirmations)
      .accounts({
        gateway: this.gatewayPDA,
        sender: this.authority.publicKey,
      })
      .signers([this.authority])
      .rpc();

    this.metrics.transactionCount++;
    return tx;
  }

  /**
   * Create TxId PDA (TX1) - Simple version for tests
   */
  async createTxPda(
    txId: BN,
    sourceChainId: BN,
    signer?: Keypair
  ): Promise<string>;
  async createTxPda(
    txId: BN,
    sourceChainId: BN,
    destChainId: BN,
    sender: Buffer,
    recipient: Buffer,
    onChainData: Buffer,
    offChainData: Buffer,
    signatures: any[],
    signer?: Keypair
  ): Promise<string>;
  async createTxPda(
    txId: BN,
    sourceChainId: BN,
    destChainIdOrSigner?: BN | Keypair,
    sender?: Buffer,
    recipient?: Buffer,
    onChainData?: Buffer,
    offChainData?: Buffer,
    signatures?: any[],
    signer?: Keypair
  ): Promise<string> {
    // Handle simple call (2-3 parameters)
    if (arguments.length <= 3) {
      // If third parameter is a Keypair, it's a signer; otherwise it's undefined
      const actualSigner =
        destChainIdOrSigner && !(destChainIdOrSigner instanceof BN)
          ? (destChainIdOrSigner as Keypair)
          : undefined;

      const destChainId = new BN(CHAIN_IDS.SOLANA); // Default destination
      const defaultSender = Buffer.from("test_sender_address_12345", "utf8");
      const defaultRecipient = Buffer.from(
        "test_recipient_address_67890",
        "utf8"
      );
      const defaultOnChainData = Buffer.from("test_on_chain_data", "utf8");
      const defaultOffChainData = Buffer.from("test_off_chain_data", "utf8");
      // Create a valid signature for testing (program validates at least 1 signature is present)
      const validSignature = createValidSignature(
        txId,
        sourceChainId,
        destChainId,
        defaultSender,
        defaultRecipient,
        defaultOnChainData,
        defaultOffChainData,
        actualSigner || this.relayer!
      );
      const defaultSignatures = [validSignature];

      return this.createTxPdaFull(
        txId,
        sourceChainId,
        destChainId,
        defaultSender,
        defaultRecipient,
        defaultOnChainData,
        defaultOffChainData,
        defaultSignatures,
        actualSigner
      );
    }

    // Handle full call (8+ parameters)
    return this.createTxPdaFull(
      txId,
      sourceChainId,
      destChainIdOrSigner as BN,
      sender!,
      recipient!,
      onChainData!,
      offChainData!,
      signatures!,
      signer
    );
  }

  /**
   * Create TxId PDA (TX1) - Full implementation
   */
  private async createTxPdaFull(
    txId: BN,
    sourceChainId: BN,
    destChainId: BN,
    sender: Buffer,
    recipient: Buffer,
    onChainData: Buffer,
    offChainData: Buffer,
    signatures: any[],
    signer?: Keypair
  ): Promise<string> {
    const relayer = signer || this.relayer;
    if (!relayer) {
      throw new Error("Relayer not initialized");
    }

    const [txIdPDA] = deriveTxIdPDA(
      this.program.programId,
      sourceChainId,
      txId
    );
    const [counterPDA] = deriveCounterPDA(
      this.program.programId,
      sourceChainId
    );

    // If no signatures provided, generate a valid one for testing
    let validSignatures = signatures;
    let ed25519Instructions: TransactionInstruction[] = [];

    if (!signatures || signatures.length === 0) {
      const validSignature = createValidSignature(
        txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData,
        relayer
      );
      // Convert to the format expected by the Anchor program
      validSignatures = [
        {
          signature: Array.from(validSignature.signature),
          signer: validSignature.signer,
        },
      ];
      ed25519Instructions.push(validSignature.ed25519Instruction);
    } else {
      // Extract Ed25519 instructions from provided signatures
      for (const sig of signatures) {
        if (sig.ed25519Instruction) {
          ed25519Instructions.push(sig.ed25519Instruction);
        }
      }
    }

    // Build the createTxPda instruction using Anchor
    const createTxPdaInstruction = await this.program.methods
      .createTxPda(
        txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData,
        validSignatures
      )
      .accounts({
        txIdPda: txIdPDA,
        counterPda: counterPDA,
        relayer: relayer.publicKey,
        systemProgram: SystemProgram.programId,
        instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    // Build the complete transaction with Ed25519 instructions first
    const transaction = new Transaction();

    // Add Ed25519 instructions first (they need to be earlier in the transaction)
    for (const ed25519Ix of ed25519Instructions) {
      transaction.add(ed25519Ix);
    }

    // Add the main program instruction
    transaction.add(createTxPdaInstruction);

    // Send the transaction
    const tx = await this.provider.sendAndConfirm(transaction, [relayer]);

    this.metrics.transactionCount++;
    return tx;
  }

  /**
   * Process message (TX2)
   */
  async processMessage(
    txId: BN,
    sourceChainId: BN,
    destChainId: BN,
    sender: Buffer,
    recipient: Buffer,
    onChainData: Buffer,
    offChainData: Buffer,
    signatures: any[] = [],
    signer?: Keypair
  ): Promise<string> {
    const relayer = signer || this.relayer;
    if (!relayer || !this.gatewayPDA) {
      throw new Error("Context not properly setup");
    }

    const [txIdPDA] = deriveTxIdPDA(
      this.program.programId,
      sourceChainId,
      txId
    );

    // Derive signer registry PDAs
    const [viaRegistry] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from([0]),
        destChainId.toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );
    const [chainRegistry] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from([1]),
        sourceChainId.toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );
    const [projectRegistry] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from([2]),
        destChainId.toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );

    // If no signatures provided, generate a valid one for testing
    let validSignatures = signatures;
    let ed25519Instructions: TransactionInstruction[] = [];

    if (!signatures || signatures.length === 0) {
      // Use one signer for all layers (overlapping membership model)
      // Create two different signatures from two different signers to meet MIN_SIGNATURES_REQUIRED = 2
      const signer1 = relayer; // First signer
      const signer2 = Keypair.generate(); // Second signer

      const signature1 = createValidSignature(
        txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData,
        signer1
      );

      const signature2 = createValidSignature(
        txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData,
        signer2
      );

      // Convert to the format expected by the Anchor program
      // Need at least 2 signatures (MIN_SIGNATURES_REQUIRED = 2)
      validSignatures = [
        {
          signature: Array.from(signature1.signature),
          signer: signature1.signer,
        },
        {
          signature: Array.from(signature2.signature),
          signer: signature2.signer,
        },
      ];

      ed25519Instructions = [
        signature1.ed25519Instruction,
        signature2.ed25519Instruction,
      ];

      // Initialize registries with both signers for overlapping membership
      try {
        await this.initializeSignerRegistry(
          "VIA",
          destChainId,
          [signature1.signer, signature2.signer],
          1
        );
      } catch (error) {
        console.log(`VIA registry error: ${error.message}`);
      }

      try {
        await this.initializeSignerRegistry(
          "Chain",
          sourceChainId,
          [signature1.signer, signature2.signer],
          1
        );
      } catch (error) {
        console.log(`Chain registry error: ${error.message}`);
      }

      try {
        await this.initializeSignerRegistry(
          "Project",
          destChainId,
          [signature1.signer, signature2.signer],
          1
        );
      } catch (error) {
        console.log(`Project registry error: ${error.message}`);
      }
    } else {
      // For explicit signatures, initialize registries with relayer pubkey
      try {
        await this.initializeSignerRegistry(
          "VIA",
          destChainId,
          [relayer.publicKey],
          1
        );
      } catch (error) {
        // Registry might already exist, that's fine
      }

      try {
        await this.initializeSignerRegistry(
          "Chain",
          sourceChainId,
          [relayer.publicKey],
          1
        );
      } catch (error) {
        // Registry might already exist, that's fine
      }

      try {
        await this.initializeSignerRegistry(
          "Project",
          destChainId,
          [relayer.publicKey],
          1
        );
      } catch (error) {
        // Registry might already exist, that's fine
      }
    }

    const tx = await this.program.methods
      .processMessage(
        txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData,
        validSignatures
      )
      .accounts({
        gateway: this.gatewayPDA,
        txIdPda: txIdPDA,
        viaRegistry: viaRegistry,
        chainRegistry: chainRegistry,
        projectRegistry: projectRegistry,
        relayer: relayer.publicKey,
        systemProgram: SystemProgram.programId,
        instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .preInstructions(ed25519Instructions)
      .signers([relayer])
      .rpc();

    this.metrics.transactionCount++;
    return tx;
  }

  /**
   * Set system enabled/disabled
   */
  async setSystemEnabled(enabled: boolean, signer?: Keypair): Promise<string> {
    const authority = signer || this.authority;
    if (!authority || !this.gatewayPDA) {
      throw new Error("Context not properly setup");
    }

    const tx = await this.program.methods
      .setSystemEnabled(enabled)
      .accounts({
        gateway: this.gatewayPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    this.metrics.transactionCount++;
    return tx;
  }

  /**
   * Helper to get all PDAs for a message
   */
  getMessagePDAs(sourceChainId: BN, txId: BN) {
    const [txIdPDA, txIdBump] = deriveTxIdPDA(
      this.program.programId,
      sourceChainId,
      txId
    );
    const [counterPDA, counterBump] = deriveCounterPDA(
      this.program.programId,
      sourceChainId
    );

    return {
      txIdPDA,
      txIdBump,
      counterPDA,
      counterBump,
      gatewayPDA: this.gatewayPDA!,
      gatewayBump: this.gatewayBump!,
    };
  }

  /**
   * Update compute units metric
   */
  addComputeUnits(units: number): void {
    this.metrics.totalComputeUnits += units;
  }

  /**
   * Initialize a signer registry (VIA, Chain, or Project)
   */
  async initializeSignerRegistry(
    registryType: any, // 'VIA' | 'Chain' | 'Project'
    chainId: BN,
    signers: PublicKey[],
    requiredSignatures: number = 1,
    signer?: Keypair
  ): Promise<string> {
    const authority = signer || this.authority;
    if (!authority || !this.gatewayPDA) {
      throw new Error("Context not properly setup");
    }

    // Derive signer registry PDA
    const registryTypeDiscriminant =
      registryType === "VIA" ? 0 : registryType === "Chain" ? 1 : 2;
    const [signerRegistryPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from([registryTypeDiscriminant]),
        chainId.toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );

    const tx = await this.program.methods
      .initializeSignerRegistry(
        { [registryType.toLowerCase()]: {} }, // Convert to enum format
        chainId,
        signers,
        requiredSignatures
      )
      .accounts({
        signerRegistry: signerRegistryPDA,
        gateway: this.gatewayPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    this.metrics.transactionCount++;
    logInfo(`${registryType} registry initialized`, tx);
    return tx;
  }

  /**
   * Setup test signer registries with current relayer as authorized signer
   */
  async setupTestSignerRegistries(): Promise<void> {
    if (!this.relayer || !this.authority) {
      throw new Error("Context not properly setup");
    }

    console.log("🔐 Setting up test signer registries...");

    // For test:u3, we need the source chain ID from the test data
    // Let's use a common test source chain ID
    const testSourceChainId = new BN(1); // Ethereum mainnet for tests
    const testDestChainId = this.chainId; // Current test chain

    try {
      // Initialize VIA registry with relayer as authorized signer
      await this.initializeSignerRegistry(
        "VIA",
        testDestChainId,
        [this.relayer.publicKey],
        1
      );

      // Initialize Chain registry with relayer as authorized signer
      await this.initializeSignerRegistry(
        "Chain",
        testSourceChainId,
        [this.relayer.publicKey],
        1
      );

      // Initialize Project registry with relayer as authorized signer
      await this.initializeSignerRegistry(
        "Project",
        testDestChainId,
        [this.relayer.publicKey],
        1
      );

      logInfo("VIA Registry", "Initialized with relayer as signer");
      logInfo("Chain Registry", "Initialized with relayer as signer");
      logInfo("Project Registry", "Initialized with relayer as signer");
      console.log("✅ Signer registries setup complete");
    } catch (error) {
      console.warn("⚠️ Could not setup signer registries:", error);
      // Don't fail the test, registries might already exist
    }
  }

  /**
   * Get signer registry PDA
   */
  getSignerRegistryPDA(registryType: string, chainId: BN): [PublicKey, number] {
    const registryTypeDiscriminant =
      registryType === "VIA" ? 0 : registryType === "Chain" ? 1 : 2;
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("signer_registry"),
        Buffer.from([registryTypeDiscriminant]),
        chainId.toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );
  }
}
