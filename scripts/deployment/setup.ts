#!/usr/bin/env ts-node
/**
 * Post-Deployment Setup Script
 *
 * Automated initialization of gateways and signer registries after program deployment.
 * This script handles the complete post-deployment setup for Via Labs V4 Message Gateway.
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BN } from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ChainConfig {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
}

interface SignerConfig {
  type: "VIA" | "Chain" | "Project";
  signers: string[];
  threshold: number;
  enabled: boolean;
}

export interface SetupConfig {
  chains: ChainConfig[];
  signerRegistries: { [chainId: number]: SignerConfig[] };
  authority?: string;
  skipExisting?: boolean;
  dryRun?: boolean;
}

export interface SetupResult {
  success: boolean;
  gatewaysInitialized: number;
  registriesInitialized: number;
  countersInitialized: number;
  errors: string[];
  warnings: string[];
  transactions: string[];
}

class PostDeploymentSetup {
  private connection: Connection;
  private provider: AnchorProvider;
  private authority: Keypair;
  private networkUrl: string;
  private programId: PublicKey;
  private idl: any;

  constructor(networkUrl: string, programId: PublicKey, walletPath: string) {
    this.networkUrl = networkUrl;
    this.programId = programId;
    this.connection = new Connection(networkUrl, "confirmed");
    this.authority = this.loadKeypair(walletPath);

    const wallet = new Wallet(this.authority);
    this.provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });

    anchor.setProvider(this.provider);

    // Load IDL dynamically
    const idlPath = path.join(
      __dirname,
      "../../target/idl/message_gateway_v4.json"
    );
    if (fs.existsSync(idlPath)) {
      this.idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
    } else {
      throw new Error(
        `IDL file not found at ${idlPath}. Run deployment first to generate IDL.`
      );
    }
  }

  /**
   * Get instruction discriminator from IDL
   */
  private getInstructionDiscriminator(instructionName: string): Buffer {
    const instruction = this.idl.instructions.find(
      (ix: any) => ix.name === instructionName
    );
    if (!instruction) {
      throw new Error(`Instruction ${instructionName} not found in IDL`);
    }
    return Buffer.from(instruction.discriminator);
  }

  /**
   * Check if an account exists
   */
  private async accountExists(address: PublicKey): Promise<boolean> {
    try {
      const accountInfo = await this.connection.getAccountInfo(address);
      return accountInfo !== null;
    } catch {
      return false;
    }
  }

  /**
   * PDA utility methods
   */
  private async getGatewayPDA(chainId: number): Promise<PublicKey> {
    const [gatewayPDA] = await PublicKey.findProgramAddress(
      [Buffer.from("gateway"), new BN(chainId).toArrayLike(Buffer, "le", 8)],
      this.programId
    );
    return gatewayPDA;
  }

  private async getSignerRegistryPDA(
    registryType: string,
    chainId: number
  ): Promise<PublicKey> {
    const [registryPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from("signer_registry"),
        new BN(this.getRegistryTypeDiscriminant(registryType)).toArrayLike(
          Buffer,
          "le",
          1
        ),
        new BN(chainId).toArrayLike(Buffer, "le", 8),
      ],
      this.programId
    );
    return registryPDA;
  }

  private async getCounterPDA(sourceChainId: number): Promise<PublicKey> {
    const [counterPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from("counter"),
        new BN(sourceChainId).toArrayLike(Buffer, "le", 8),
      ],
      this.programId
    );
    return counterPDA;
  }

  /**
   * Instruction building helpers
   */
  private buildGatewayInstruction(
    gatewayPDA: PublicKey,
    chainId: number
  ): TransactionInstruction {
    const discriminator =
      this.getInstructionDiscriminator("initialize_gateway");
    const chainIdBuffer = new BN(chainId).toArrayLike(Buffer, "le", 8);

    return new TransactionInstruction({
      keys: [
        { pubkey: gatewayPDA, isSigner: false, isWritable: true },
        { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: Buffer.concat([discriminator, chainIdBuffer]),
    });
  }

  private buildRegistryInstruction(
    registryPDA: PublicKey,
    gatewayPDA: PublicKey,
    registryType: string,
    chainId: number,
    signers: PublicKey[],
    threshold: number
  ): TransactionInstruction {
    const discriminator = this.getInstructionDiscriminator(
      "initialize_signer_registry"
    );
    const registryTypeBuffer = new BN(
      this.getRegistryTypeDiscriminant(registryType)
    ).toArrayLike(Buffer, "le", 1);
    const chainIdBuffer = new BN(chainId).toArrayLike(Buffer, "le", 8);
    const thresholdBuffer = Buffer.from([threshold]);
    const signersLengthBuffer = new BN(signers.length).toArrayLike(
      Buffer,
      "le",
      4
    );
    const signersBuffer = Buffer.concat(signers.map((pk) => pk.toBuffer()));

    return new TransactionInstruction({
      keys: [
        { pubkey: registryPDA, isSigner: false, isWritable: true },
        { pubkey: gatewayPDA, isSigner: false, isWritable: false },
        { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: Buffer.concat([
        discriminator,
        registryTypeBuffer,
        chainIdBuffer,
        signersLengthBuffer,
        signersBuffer,
        thresholdBuffer,
      ]),
    });
  }

  /**
   * Build Counter PDA initialization instruction using the proper initialize_counter instruction
   */
  private buildCounterInstruction(
    counterPDA: PublicKey,
    chainId: number
  ): TransactionInstruction {
    // Use the proper initialize_counter instruction
    const discriminator = this.getInstructionDiscriminator("initialize_counter");
    
    const sourceChainId = new BN(chainId);
    
    // Get gateway PDA for Solana (chain ID 1) to verify authority
    const gatewaySeeds = [
      Buffer.from("gateway"),
      new BN(1).toArrayLike(Buffer, "le", 8), // Solana chain ID
    ];
    const [gatewayPDA] = PublicKey.findProgramAddressSync(gatewaySeeds, this.programId);

    return new TransactionInstruction({
      keys: [
        { pubkey: counterPDA, isSigner: false, isWritable: true },
        { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: gatewayPDA, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: Buffer.concat([
        discriminator,
        sourceChainId.toArrayLike(Buffer, "le", 8),
      ]),
    });
  }

  /**
   * @deprecated - No longer needed with proper initialize_counter instruction
   */
  private createDummySignatures(): Buffer {
    // This method is no longer needed
    const dummySignature = Buffer.alloc(64, 0);
    const dummySigner = this.authority.publicKey.toBuffer();
    
    const messageSignature = Buffer.concat([dummySignature, dummySigner]);
    
    // Borsh Vec<MessageSignature> format: 4-byte length + data
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32LE(1, 0); // One signature
    
    return Buffer.concat([lengthBuf, messageSignature]);
  }

  /**
   * Main setup orchestrator
   */
  async setup(config: SetupConfig): Promise<SetupResult> {
    const result: SetupResult = {
      success: false,
      gatewaysInitialized: 0,
      registriesInitialized: 0,
      countersInitialized: 0,
      errors: [],
      warnings: [],
      transactions: [],
    };

    try {
      console.log("🚀 Starting Post-Deployment Setup...");
      console.log(`📍 Program ID: ${this.programId.toString()}`);
      console.log(`👤 Authority: ${this.authority.publicKey.toString()}`);
      console.log(`🌐 Network: ${this.networkUrl}`);

      // Validate authority has sufficient balance
      await this.validateAuthority(result);

      // Initialize gateways for each chain
      for (const chain of config.chains) {
        if (chain.enabled) {
          await this.initializeGateway(chain, config, result);
        }
      }

      // Initialize Counter PDAs for each chain
      for (const chain of config.chains) {
        if (chain.enabled) {
          await this.initializeCounterPDA(chain, config, result);
        }
      }

      // Initialize signer registries
      for (const [chainId, registries] of Object.entries(
        config.signerRegistries
      )) {
        const chainIdNum = parseInt(chainId);
        for (const registry of registries) {
          if (registry.enabled) {
            await this.initializeSignerRegistry(
              chainIdNum,
              registry,
              config,
              result
            );
          }
        }
      }

      result.success = result.errors.length === 0;
      this.printSetupSummary(result);

      return result;
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      result.success = false;
      this.printSetupSummary(result);
      return result;
    }
  }

  /**
   * Initialize gateway for a specific chain
   */
  private async initializeGateway(
    chain: ChainConfig,
    config: SetupConfig,
    result: SetupResult
  ): Promise<void> {
    try {
      console.log(
        `\n🔧 Initializing Gateway for Chain ${chain.id} (${chain.name})...`
      );

      // Get gateway PDA
      const gatewayPDA = await this.getGatewayPDA(chain.id);

      // Check if gateway already exists
      if (config.skipExisting) {
        if (await this.accountExists(gatewayPDA)) {
          console.log(
            `⚠️  Gateway for chain ${chain.id} already exists, skipping...`
          );
          result.warnings.push(`Gateway for chain ${chain.id} already exists`);
          return;
        }
      }

      if (config.dryRun) {
        console.log(
          `🧪 DRY RUN: Would initialize gateway for chain ${chain.id}`
        );
        console.log(`   Gateway PDA: ${gatewayPDA.toString()}`);
        return;
      }

      // Build initialize gateway instruction
      const instruction = this.buildGatewayInstruction(gatewayPDA, chain.id);

      const tx = await this.provider.sendAndConfirm(
        new Transaction().add(instruction),
        [this.authority]
      );

      console.log(`✅ Gateway initialized for chain ${chain.id}`);
      console.log(`   Gateway PDA: ${gatewayPDA.toString()}`);
      console.log(`   Transaction: ${tx}`);

      result.gatewaysInitialized++;
      result.transactions.push(tx);
    } catch (error) {
      const errorMsg = `Failed to initialize gateway for chain ${chain.id}: ${error}`;
      console.error(`❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  /**
   * Initialize Counter PDA for a specific chain
   */
  private async initializeCounterPDA(
    chain: ChainConfig,
    config: SetupConfig,
    result: SetupResult
  ): Promise<void> {
    try {
      console.log(
        `\n📊 Initializing Counter PDA for Chain ${chain.id} (${chain.name})...`
      );

      // Get counter PDA
      const counterPDA = await this.getCounterPDA(chain.id);

      // Check if counter already exists
      if (config.skipExisting) {
        if (await this.accountExists(counterPDA)) {
          console.log(
            `⚠️  Counter PDA for chain ${chain.id} already exists, skipping...`
          );
          result.warnings.push(`Counter PDA for chain ${chain.id} already exists`);
          return;
        }
      }

      if (config.dryRun) {
        console.log(
          `🧪 DRY RUN: Would initialize Counter PDA for chain ${chain.id}`
        );
        console.log(`   Counter PDA: ${counterPDA.toString()}`);
        return;
      }

      // Build initialize counter PDA instruction
      const instruction = this.buildCounterInstruction(counterPDA, chain.id);

      const tx = await this.provider.sendAndConfirm(
        new Transaction().add(instruction),
        [this.authority]
      );

      console.log(`✅ Counter PDA initialized for chain ${chain.id}`);
      console.log(`   Counter PDA: ${counterPDA.toString()}`);
      console.log(`   Transaction: ${tx}`);

      result.countersInitialized++;
      result.transactions.push(tx);
    } catch (error) {
      const errorMsg = `Failed to initialize Counter PDA for chain ${chain.id}: ${error}`;
      console.error(`❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  /**
   * Initialize signer registry
   */
  private async initializeSignerRegistry(
    chainId: number,
    registry: SignerConfig,
    config: SetupConfig,
    result: SetupResult
  ): Promise<void> {
    try {
      console.log(
        `\n🔐 Initializing ${registry.type} Signer Registry for Chain ${chainId}...`
      );

      // Get PDAs
      const registryPDA = await this.getSignerRegistryPDA(
        registry.type,
        chainId
      );
      const gatewayPDA = await this.getGatewayPDA(chainId);

      // Check if registry already exists
      if (config.skipExisting) {
        if (await this.accountExists(registryPDA)) {
          console.log(
            `⚠️  ${registry.type} registry for chain ${chainId} already exists, skipping...`
          );
          result.warnings.push(
            `${registry.type} registry for chain ${chainId} already exists`
          );
          return;
        }
      }

      // Convert signer strings to PublicKeys
      const signerPubkeys = registry.signers.map((signer) => {
        try {
          return new PublicKey(signer);
        } catch (error) {
          throw new Error(`Invalid signer public key: ${signer}`);
        }
      });

      // Validate threshold
      if (registry.threshold < 1 || registry.threshold > signerPubkeys.length) {
        throw new Error(
          `Invalid threshold ${registry.threshold} for ${signerPubkeys.length} signers`
        );
      }

      if (config.dryRun) {
        console.log(
          `🧪 DRY RUN: Would initialize ${registry.type} registry for chain ${chainId}`
        );
        console.log(`   Registry PDA: ${registryPDA.toString()}`);
        console.log(`   Signers: ${signerPubkeys.length}`);
        console.log(`   Threshold: ${registry.threshold}`);
        return;
      }

      // Build registry instruction
      const instruction = this.buildRegistryInstruction(
        registryPDA,
        gatewayPDA,
        registry.type,
        chainId,
        signerPubkeys,
        registry.threshold
      );

      const tx = await this.provider.sendAndConfirm(
        new Transaction().add(instruction),
        [this.authority]
      );

      console.log(
        `✅ ${registry.type} registry initialized for chain ${chainId}`
      );
      console.log(`   Registry PDA: ${registryPDA.toString()}`);
      console.log(`   Signers: ${signerPubkeys.length}`);
      console.log(`   Threshold: ${registry.threshold}`);
      console.log(`   Transaction: ${tx}`);

      result.registriesInitialized++;
      result.transactions.push(tx);
    } catch (error) {
      const errorMsg = `Failed to initialize ${registry.type} registry for chain ${chainId}: ${error}`;
      console.error(`❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  /**
   * Validate authority has sufficient balance
   */
  private async validateAuthority(result: SetupResult): Promise<void> {
    try {
      const balance = await this.connection.getBalance(
        this.authority.publicKey
      );
      const balanceSOL = balance / anchor.web3.LAMPORTS_PER_SOL;

      console.log(`💰 Authority Balance: ${balanceSOL.toFixed(4)} SOL`);

      if (balanceSOL < 0.1) {
        const warning = `Low balance: ${balanceSOL.toFixed(
          4
        )} SOL. May not be sufficient for setup.`;
        console.warn(`⚠️  ${warning}`);
        result.warnings.push(warning);
      }
    } catch (error) {
      result.errors.push(`Failed to check authority balance: ${error}`);
    }
  }

  /**
   * Load keypair from file path
   */
  private loadKeypair(walletPath: string): Keypair {
    try {
      // Handle tilde expansion
      const expandedPath = walletPath.startsWith("~")
        ? walletPath.replace("~", os.homedir())
        : walletPath;

      const secretKeyString = fs.readFileSync(expandedPath, "utf8");
      const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      throw new Error(`Failed to load keypair from ${walletPath}: ${error}`);
    }
  }

  /**
   * Get registry type discriminant for PDA seeds
   */
  private getRegistryTypeDiscriminant(type: string): number {
    switch (type) {
      case "VIA":
        return 0;
      case "Chain":
        return 1;
      case "Project":
        return 2;
      default:
        throw new Error(`Unknown registry type: ${type}`);
    }
  }

  /**
   * Print setup summary
   */
  private printSetupSummary(result: SetupResult): void {
    console.log("\n" + "=".repeat(60));
    console.log("📊 POST-DEPLOYMENT SETUP SUMMARY");
    console.log("=".repeat(60));
    console.log(`Status: ${result.success ? "✅ SUCCESS" : "❌ FAILED"}`);
    console.log(`Gateways Initialized: ${result.gatewaysInitialized}`);
    console.log(`Registries Initialized: ${result.registriesInitialized}`);
    console.log(`Counter PDAs Initialized: ${result.countersInitialized}`);
    console.log(`Transactions: ${result.transactions.length}`);

    if (result.warnings.length > 0) {
      console.log("\n⚠️  WARNINGS:");
      result.warnings.forEach((warning) => console.log(`  - ${warning}`));
    }

    if (result.errors.length > 0) {
      console.log("\n❌ ERRORS:");
      result.errors.forEach((error) => console.log(`  - ${error}`));
    }

    if (result.transactions.length > 0) {
      console.log("\n🔗 TRANSACTIONS:");
      result.transactions.forEach((tx) => console.log(`  - ${tx}`));
    }

    console.log("=".repeat(60));
  }
}

/**
 * Load network configuration
 */
function loadNetworkConfig(network: string) {
  const networkConfigPath = path.join(__dirname, "network-config.json");
  const networkConfig = JSON.parse(fs.readFileSync(networkConfigPath, "utf8"));
  const networkInfo = networkConfig.networks[network];

  if (!networkInfo) {
    throw new Error(`Unknown network: ${network}`);
  }

  return networkInfo;
}

/**
 * Load configuration from file or create default
 */
function loadSetupConfig(configPath?: string): SetupConfig {
  const defaultConfig: SetupConfig = {
    chains: [
      {
        id: 1,
        name: "Solana",
        description: "Solana blockchain",
        enabled: true,
      },
      {
        id: 2,
        name: "Ethereum",
        description: "Ethereum blockchain",
        enabled: false,
      },
      {
        id: 3,
        name: "Polygon",
        description: "Polygon blockchain",
        enabled: false,
      },
    ],
    signerRegistries: {
      1: [
        {
          type: "VIA",
          signers: [
            "11111111111111111111111111111112", // Replace with actual VIA signer keys
          ],
          threshold: 1,
          enabled: true,
        },
        {
          type: "Chain",
          signers: [
            "11111111111111111111111111111112", // Replace with actual chain signer keys
          ],
          threshold: 1,
          enabled: true,
        },
      ],
    },
    skipExisting: true,
    dryRun: false,
  };

  if (configPath && fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, "utf8");
      return { ...defaultConfig, ...JSON.parse(fileContent) };
    } catch (error) {
      console.warn(
        `⚠️  Failed to load config from ${configPath}, using defaults: ${error}`
      );
    }
  }

  return defaultConfig;
}

/**
 * Parse CLI arguments
 */
interface CLIArgs {
  network: string;
  configPath?: string;
  programId?: string;
  walletPath?: string;
  dryRun: boolean;
  skipExisting: boolean;
}

function parseArgs(): CLIArgs | null {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    console.log("🚀 Via Labs V4 Post-Deployment Setup Tool");
    console.log("\nUsage: yarn setup <network> [options]");
    console.log("Networks: localnet, devnet, testnet, mainnet");
    console.log(
      "Options: --config <path>, --program-id <id>, --wallet <path>, --dry-run, --force"
    );
    return null;
  }

  const result: CLIArgs = {
    network: args[0],
    dryRun: args.includes("--dry-run"),
    skipExisting: !args.includes("--force"),
  };

  // Parse options with values
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--config") result.configPath = args[++i];
    else if (args[i] === "--program-id") result.programId = args[++i];
    else if (args[i] === "--wallet") result.walletPath = args[++i];
  }

  return result;
}

// CLI Interface
async function main() {
  const cliArgs = parseArgs();
  if (!cliArgs) return;

  try {
    // Load network configuration
    const networkConfig = loadNetworkConfig(cliArgs.network);
    const finalProgramId =
      cliArgs.programId || networkConfig.programId || process.env.PROGRAM_ID;
    const finalWalletPath =
      cliArgs.walletPath ||
      networkConfig.walletPath ||
      process.env.ANCHOR_WALLET ||
      "~/.config/solana/id.json";

    if (!finalProgramId) {
      throw new Error(
        `Program ID not found. Specify --program-id or set PROGRAM_ID environment variable`
      );
    }

    // Load setup configuration
    const config = loadSetupConfig(cliArgs.configPath);
    config.dryRun = cliArgs.dryRun;
    config.skipExisting = cliArgs.skipExisting;

    // Initialize and execute setup
    const setupManager = new PostDeploymentSetup(
      networkConfig.url,
      new PublicKey(finalProgramId),
      finalWalletPath
    );

    const result = await setupManager.setup(config);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`❌ Setup failed: ${error}`);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { PostDeploymentSetup };
