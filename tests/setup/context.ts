import { BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, SystemProgram } from "@solana/web3.js";
import { MessageGatewayV4 } from "../../target/types/message_gateway_v4";
import { 
  deriveGatewayPDA, 
  deriveTxIdPDA, 
  deriveCounterPDA,
  fundAccount,
  createFundedKeypair,
  wait,
  logInfo
} from "./helpers";
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
    this.program = anchor.workspace.MessageGatewayV4 as Program<MessageGatewayV4>;
    this.connection = this.provider.connection;
    
    // Use a unique chain ID for each test context if not provided
    this.chainId = chainId || new BN(Math.floor(Math.random() * 1000000) + 1000);
    
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
    this.authority = options?.customAuthority || 
      await createFundedKeypair(this.connection, TEST_CONFIG.AIRDROP_AMOUNT);
    
    this.relayer = options?.customRelayer || 
      await createFundedKeypair(this.connection, TEST_CONFIG.AIRDROP_AMOUNT);
    
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
    logInfo("Total compute units", this.metrics.totalComputeUnits.toLocaleString());
    logInfo("Elapsed time", `${elapsed}ms`);
    
    if (this.metrics.transactionCount > 0) {
      logInfo(
        "Avg CU per transaction", 
        Math.round(this.metrics.totalComputeUnits / this.metrics.transactionCount).toLocaleString()
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
   * Create TxId PDA (TX1)
   */
  async createTxPda(
    txId: BN,
    sourceChainId: BN,
    signer?: Keypair
  ): Promise<string> {
    const relayer = signer || this.relayer;
    if (!relayer) {
      throw new Error("Relayer not initialized");
    }
    
    const [txIdPDA] = deriveTxIdPDA(this.program.programId, sourceChainId, txId);
    const [counterPDA] = deriveCounterPDA(this.program.programId, sourceChainId);
    
    const tx = await this.program.methods
      .createTxPda(txId, sourceChainId)
      .accounts({
        txIdPda: txIdPDA,
        counterPda: counterPDA,
        relayer: relayer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([relayer])
      .rpc();
    
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
    signer?: Keypair
  ): Promise<string> {
    const relayer = signer || this.relayer;
    if (!relayer || !this.gatewayPDA) {
      throw new Error("Context not properly setup");
    }
    
    const [txIdPDA] = deriveTxIdPDA(this.program.programId, sourceChainId, txId);
    
    const tx = await this.program.methods
      .processMessage(
        txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData
      )
      .accounts({
        gateway: this.gatewayPDA,
        txIdPda: txIdPDA,
        relayer: relayer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([relayer])
      .rpc();
    
    this.metrics.transactionCount++;
    return tx;
  }

  /**
   * Set system enabled/disabled
   */
  async setSystemEnabled(
    enabled: boolean,
    signer?: Keypair
  ): Promise<string> {
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
    const [txIdPDA, txIdBump] = deriveTxIdPDA(this.program.programId, sourceChainId, txId);
    const [counterPDA, counterBump] = deriveCounterPDA(this.program.programId, sourceChainId);
    
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
}