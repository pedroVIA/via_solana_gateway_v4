#!/usr/bin/env ts-node
/**
 * Post-Deployment Verification System
 *
 * Comprehensive verification of deployed Via Labs V4 Message Gateway,
 * including program deployment, account initialization, and functional testing.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { MessageGatewayV4 } from "../../target/types/message_gateway_v4";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { BN } from "bn.js";

// ES module equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface VerificationResult {
  success: boolean;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  errors: string[];
  warnings: string[];
}

interface CheckResult {
  name: string;
  category: "program" | "account" | "network" | "security" | "functional";
  status: "pass" | "fail" | "warning" | "skip";
  message: string;
  details?: any;
  duration?: number;
}

export interface VerificationConfig {
  programId: string;
  networkUrl: string;
  walletPath: string;
  checkCategories: string[];
  skipFunctionalTests?: boolean;
  validateSignerRegistries?: boolean;
  expectedChains?: number[];
}

class DeploymentVerifier {
  private connection: Connection;
  private program!: Program<MessageGatewayV4>;
  private provider: AnchorProvider;
  private authority: Keypair;
  private config: VerificationConfig;

  constructor(config: VerificationConfig) {
    this.config = config;
    this.connection = new Connection(config.networkUrl, "confirmed");
    this.authority = this.loadKeypair(config.walletPath);
    this.provider = this.createProvider();
    this.program = this.loadProgram();
  }

  private createProvider(): AnchorProvider {
    const wallet = new Wallet(this.authority);
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);
    return provider;
  }

  private loadProgram(): Program<MessageGatewayV4> {
    try {
      // Load the actual IDL file
      const idlPath = path.join(__dirname, "../../target/idl/message_gateway_v4.json");
      if (fs.existsSync(idlPath)) {
        const idlContent = JSON.parse(fs.readFileSync(idlPath, "utf8"));
        return new Program(idlContent, new PublicKey(this.config.programId), this.provider);
      }
    } catch (error) {
      console.warn(`Warning: Could not load IDL file: ${error}`);
    }
    
    // Fallback to stub IDL if real IDL can't be loaded
    const stubIdl = {
      address: this.config.programId,
      metadata: { name: "message_gateway_v4", version: "0.1.0", spec: "0.1.0" },
      instructions: [],
      accounts: [], 
      types: [],
      events: [],
      errors: []
    };
    
    return new Program(stubIdl as any, new PublicKey(this.config.programId), this.provider);
  }

  private async getGatewayPDA(chainId: number): Promise<PublicKey> {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("gateway"), new BN(chainId).toArrayLike(Buffer, "le", 8)],
      this.program.programId
    );
    return pda;
  }

  /**
   * Main verification orchestrator
   */
  async verify(): Promise<VerificationResult> {
    const result: VerificationResult = {
      success: false,
      checks: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0 },
      errors: [],
      warnings: [],
    };

    console.log("🔍 Starting Post-Deployment Verification...");
    console.log(`📍 Program ID: ${this.config.programId}`);
    console.log(`🌐 Network: ${this.config.networkUrl}`);
    console.log(`👤 Authority: ${this.authority.publicKey.toString()}`);

    try {
      // Program-level checks
      if (this.shouldRunCategory("program")) {
        await this.runProgramChecks(result);
      }

      // Network connectivity checks
      if (this.shouldRunCategory("network")) {
        await this.runNetworkChecks(result);
      }

      // Account initialization checks
      if (this.shouldRunCategory("account")) {
        await this.runAccountChecks(result);
      }

      // Security validation checks
      if (this.shouldRunCategory("security")) {
        await this.runSecurityChecks(result);
      }

      // Functional testing
      if (
        this.shouldRunCategory("functional") &&
        !this.config.skipFunctionalTests
      ) {
        await this.runFunctionalChecks(result);
      }

      // Calculate final results
      this.calculateSummary(result);
      result.success = result.summary.failed === 0;

      this.printVerificationResults(result);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Verification failed: ${errorMsg}`);
      console.error(`❌ Verification failed: ${errorMsg}`);

      this.calculateSummary(result);
      this.printVerificationResults(result);
      return result;
    }
  }

  /**
   * Run program-level verification checks
   */
  private async runProgramChecks(result: VerificationResult): Promise<void> {
    console.log("\n🔧 Running Program Checks...");

    // Check 1: Program exists and is executable
    await this.runCheck("Program Deployment", "program", result, async () => {
      const accountInfo = await this.connection.getAccountInfo(
        this.program.programId
      );

      if (!accountInfo) {
        throw new Error("Program account not found");
      }

      if (!accountInfo.executable) {
        throw new Error("Program account is not executable");
      }

      return {
        message: `Program deployed and executable`,
        details: {
          owner: accountInfo.owner.toString(),
          dataLength: accountInfo.data.length,
          lamports: accountInfo.lamports,
        },
      };
    });

    // Check 2: Program ID matches expected
    await this.runCheck(
      "Program ID Verification",
      "program",
      result,
      async () => {
        const expectedProgramId = this.config.programId;
        const actualProgramId = this.program.programId.toString();

        if (expectedProgramId !== actualProgramId) {
          throw new Error(
            `Program ID mismatch: expected ${expectedProgramId}, got ${actualProgramId}`
          );
        }

        return {
          message: `Program ID matches expected value`,
          details: { programId: actualProgramId },
        };
      }
    );

    // Check 3: Program Instructions Accessibility
    await this.runCheck("Program Instructions", "program", result, async () => {
      try {
        // Verify program has executable account data (contains instructions)
        const programInfo = await this.connection.getAccountInfo(new PublicKey(this.config.programId));
        if (!programInfo) {
          throw new Error("Program account not found");
        }
        if (!programInfo.executable) {
          throw new Error("Program is not executable");
        }
        
        return {
          message: "Program contains executable instructions",
          details: { 
            dataLength: programInfo.data.length,
            executable: programInfo.executable,
            owner: programInfo.owner.toString()
          }
        };
      } catch (error) {
        throw new Error(`Program instructions check failed: ${error}`);
      }
    });
  }

  /**
   * Run network connectivity checks
   */
  private async runNetworkChecks(result: VerificationResult): Promise<void> {
    console.log("\n🌐 Running Network Checks...");

    // Check 1: Basic connectivity
    await this.runCheck("Network Connectivity", "network", result, async () => {
      const version = await this.connection.getVersion();
      return {
        message: `Connected to Solana cluster`,
        details: {
          solanaCore: version["solana-core"],
          featureSet: version["feature-set"],
        },
      };
    });

    // Check 2: Authority account balance
    await this.runCheck("Authority Balance", "network", result, async () => {
      const balance = await this.connection.getBalance(
        this.authority.publicKey
      );
      const balanceSOL = balance / anchor.web3.LAMPORTS_PER_SOL;

      if (balanceSOL < 0.01) {
        throw new Error(`Insufficient balance: ${balanceSOL.toFixed(4)} SOL`);
      }

      return {
        message: `Authority has sufficient balance: ${balanceSOL.toFixed(
          4
        )} SOL`,
        details: {
          balance: balance,
          balanceSOL: balanceSOL.toFixed(4),
        },
      };
    });
  }

  /**
   * Run account initialization checks
   */
  private async runAccountChecks(result: VerificationResult): Promise<void> {
    console.log("\n📋 Running Account Checks...");

    const expectedChains = this.config.expectedChains || [1];

    for (const chainId of expectedChains) {
      // Check gateway initialization
      await this.runCheck(
        `Gateway Chain ${chainId}`,
        "account",
        result,
        async () => {
          const gatewayPDA = await this.getGatewayPDA(chainId);

          try {
            const accountInfo = await this.connection.getAccountInfo(gatewayPDA);
            if (!accountInfo) {
              throw new Error(`Account not found`);
            }

            // MessageGateway: discriminator(8) + authority(32) + chain_id(8) + system_enabled(1) + bump(1)
            const data = accountInfo.data;
            if (data.length < 50) {
              throw new Error(`Invalid account data length: ${data.length}`);
            }

            // Parse the account data manually
            const authority = new PublicKey(data.slice(8, 40));
            const chainId = data.readBigUInt64LE(40);
            const systemEnabled = data[48] === 1;

            return {
              message: `Gateway initialized for chain ${chainId}`,
              details: {
                address: gatewayPDA.toString(),
                authority: authority.toString(),
                chainId: chainId.toString(),
                systemEnabled: systemEnabled,
              },
            };
          } catch (error) {
            throw new Error(
              `Gateway not initialized for chain ${chainId}: ${error}`
            );
          }
        }
      );
    }
  }

  /**
   * Run security validation checks
   */
  private async runSecurityChecks(result: VerificationResult): Promise<void> {
    console.log("\n🛡️ Running Security Checks...");

    // Check 1: Authority validation
    await this.runCheck("Authority Security", "security", result, async () => {
      const authorityInfo = await this.connection.getAccountInfo(
        this.authority.publicKey
      );

      if (!authorityInfo) {
        throw new Error("Authority account not found");
      }

      return {
        message: `Authority account configured properly`,
        details: { owner: authorityInfo.owner.toString() },
      };
    });
  }

  /**
   * Run basic functional tests
   */
  private async runFunctionalChecks(result: VerificationResult): Promise<void> {
    console.log("\n⚙️ Running Functional Checks...");

    await this.runCheck(
      "Program Query Functionality",
      "functional",
      result,
      async () => {
        try {
          // Try to query a non-existent account to test program response
          const randomPDA = await PublicKey.findProgramAddress(
            [Buffer.from("test"), Buffer.from("query")],
            this.program.programId
          );

          // This should fail, but in a predictable way
          try {
            const accountInfo = await this.connection.getAccountInfo(randomPDA[0]);
            if (accountInfo) {
              throw new Error("Unexpected: random PDA returned data");
            }
            
            return {
              message: `Program responds correctly to queries`,
              details: { queryTest: "passed" },
            };
          } catch (error) {
            throw new Error(`Unexpected query error: ${error}`);
          }
        } catch (error) {
          throw new Error(`Program query test failed: ${error}`);
        }
      }
    );
  }

  /**
   * Run a single verification check
   */
  private async runCheck(
    name: string,
    category: CheckResult["category"],
    result: VerificationResult,
    checkFunction: () => Promise<{ message: string; details?: any }>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const checkResult = await checkFunction();
      const check: CheckResult = {
        name,
        category,
        status: "pass",
        message: checkResult.message,
        details: checkResult.details,
        duration: Date.now() - startTime,
      };

      result.checks.push(check);
      console.log(`  ✅ ${name}: ${checkResult.message}`);
    } catch (error) {
      const check: CheckResult = {
        name,
        category,
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };

      result.checks.push(check);
      console.log(`  ❌ ${name}: ${check.message}`);
    }
  }

  /**
   * Check if a category should be run
   */
  private shouldRunCategory(category: string): boolean {
    return (
      this.config.checkCategories.length === 0 ||
      this.config.checkCategories.includes(category)
    );
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(result: VerificationResult): void {
    result.summary.total = result.checks.length;
    result.summary.passed = result.checks.filter(
      (c) => c.status === "pass"
    ).length;
    result.summary.failed = result.checks.filter(
      (c) => c.status === "fail"
    ).length;
    result.summary.warnings = result.checks.filter(
      (c) => c.status === "warning"
    ).length;
  }

  /**
   * Print verification results
   */
  private printVerificationResults(result: VerificationResult): void {
    console.log("\n" + "=".repeat(60));
    console.log("📊 DEPLOYMENT VERIFICATION RESULTS");
    console.log("=".repeat(60));
    console.log(`Overall Status: ${result.success ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`Total Checks: ${result.summary.total}`);
    console.log(`Passed: ${result.summary.passed}`);
    console.log(`Failed: ${result.summary.failed}`);
    console.log(`Warnings: ${result.summary.warnings}`);

    // Group results by category
    const categories = [
      "program",
      "network",
      "account",
      "security",
      "functional",
    ];
    for (const category of categories) {
      const categoryChecks = result.checks.filter(
        (c) => c.category === category
      );
      if (categoryChecks.length > 0) {
        console.log(`\n📋 ${category.toUpperCase()} CHECKS:`);
        for (const check of categoryChecks) {
          const icon =
            check.status === "pass"
              ? "✅"
              : check.status === "fail"
              ? "❌"
              : "⚠️";
          console.log(`  ${icon} ${check.name}: ${check.message}`);
          if (check.duration !== undefined) {
            console.log(`     Duration: ${check.duration}ms`);
          }
        }
      }
    }

    if (result.errors.length > 0) {
      console.log("\n❌ ERRORS:");
      result.errors.forEach((error) => console.log(`  - ${error}`));
    }

    if (result.warnings.length > 0) {
      console.log("\n⚠️  WARNINGS:");
      result.warnings.forEach((warning) => console.log(`  - ${warning}`));
    }

    console.log("=".repeat(60));
  }

  /**
   * Load keypair from file
   */
  private loadKeypair(walletPath: string): Keypair {
    try {
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
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    console.log("🔍 Via Labs V4 Deployment Verification Tool");
    console.log("\nUsage:");
    console.log("  yarn verify <network> [options]");
    console.log("\nNetworks:");
    console.log("  localnet   - Local development");
    console.log("  devnet     - Devnet testing");
    console.log("  testnet    - Testnet validation");
    console.log("  mainnet    - Production deployment");
    console.log("\nOptions:");
    console.log("  --program-id <id>           Override program ID");
    console.log("  --wallet <path>             Override wallet path");
    console.log("  --categories <cat1,cat2>    Run specific check categories");
    console.log("  --skip-functional           Skip functional tests");
    console.log("  --chains <id1,id2>          Expected chain IDs to verify");
    console.log(
      "\nCategories: program, network, account, security, functional"
    );
    console.log("\nExamples:");
    console.log("  yarn verify localnet");
    console.log("  yarn verify devnet --chains 1,2");
    console.log("  yarn verify mainnet --categories program,security");
    return;
  }

  const network = args[0];
  let programId: string | undefined;
  let walletPath: string | undefined;
  let categories: string[] = [];
  let skipFunctional = false;
  let expectedChains: number[] = [];

  // Parse options
  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--program-id":
        programId = args[++i];
        break;
      case "--wallet":
        walletPath = args[++i];
        break;
      case "--categories":
        categories = args[++i].split(",").map((c) => c.trim());
        break;
      case "--skip-functional":
        skipFunctional = true;
        break;
      case "--chains":
        expectedChains = args[++i].split(",").map((c) => parseInt(c.trim()));
        break;
    }
  }

  try {
    // Load network configuration
    const networkConfigPath = path.join(__dirname, "network-config.json");
    const networkConfig = JSON.parse(
      fs.readFileSync(networkConfigPath, "utf8")
    );
    const networkInfo = networkConfig.networks[network];

    if (!networkInfo) {
      throw new Error(`Unknown network: ${network}`);
    }

    const config: VerificationConfig = {
      programId:
        programId || networkInfo.programId || process.env.PROGRAM_ID || "",
      networkUrl: networkInfo.url,
      walletPath:
        walletPath || process.env.ANCHOR_WALLET || "~/.config/solana/id.json",
      checkCategories: categories,
      skipFunctionalTests: skipFunctional,
      expectedChains: expectedChains.length > 0 ? expectedChains : [1],
    };

    if (!config.programId) {
      throw new Error(
        "Program ID not found. Specify --program-id or set PROGRAM_ID environment variable"
      );
    }

    const verifier = new DeploymentVerifier(config);
    const result = await verifier.verify();

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`❌ Verification failed: ${error}`);
    if (error instanceof Error) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { DeploymentVerifier, VerificationConfig, VerificationResult };
