#!/usr/bin/env ts-node
/**
 * Via Labs V4 Multi-Network Deployment Script
 *
 * Comprehensive deployment automation with pre-validation, building,
 * deployment, and post-deployment verification.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { NetworkManager } from "./network-manager.ts";

interface DeploymentOptions {
  network: string;
  skipPreValidation?: boolean;
  skipBuild?: boolean;
  skipPostValidation?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  programKeypair?: string;
}

interface DeploymentResult {
  success: boolean;
  network: string;
  programId?: string;
  txSignature?: string;
  error?: string;
  warnings?: string[];
  metrics?: {
    buildTime?: number;
    deployTime?: number;
    totalTime?: number;
    programSize?: number;
  };
}

class ViaDeploymentManager {
  private networkManager: NetworkManager;
  private startTime: number = 0;

  constructor() {
    this.networkManager = new NetworkManager();
  }

  /**
   * Main deployment orchestrator
   */
  async deploy(options: DeploymentOptions): Promise<DeploymentResult> {
    this.startTime = Date.now();

    const result: DeploymentResult = {
      success: false,
      network: options.network,
      warnings: [],
      metrics: {},
    };

    try {
      this.log(`\n🚀 Via Labs V4 Deployment Starting...`, options.verbose);
      this.log(`📍 Network: ${options.network.toUpperCase()}`, options.verbose);
      this.log(
        `⚙️  Options: ${JSON.stringify(options, null, 2)}`,
        options.verbose
      );

      // Phase 1: Pre-deployment validation
      if (!options.skipPreValidation) {
        this.log(`\n📋 Phase 1: Pre-deployment Validation`, options.verbose);
        await this.preDeploymentValidation(options, result);
      }

      // Phase 2: Network preparation
      this.log(`\n🔧 Phase 2: Network Preparation`, options.verbose);
      await this.prepareNetwork(options, result);

      // Phase 3: Build
      if (!options.skipBuild) {
        this.log(`\n🔨 Phase 3: Building Program`, options.verbose);
        await this.buildProgram(options, result);
      }

      // Phase 4: Deploy
      if (!options.dryRun) {
        this.log(
          `\n🚀 Phase 4: Deploying to ${options.network.toUpperCase()}`,
          options.verbose
        );
        await this.deployProgram(options, result);
      } else {
        this.log(
          `\n🧪 Phase 4: DRY RUN - Skipping actual deployment`,
          options.verbose
        );
      }

      // Phase 5: Post-deployment validation
      if (!options.skipPostValidation && !options.dryRun) {
        this.log(`\n✅ Phase 5: Post-deployment Validation`, options.verbose);
        await this.postDeploymentValidation(options, result);
      }

      // Calculate final metrics
      result.metrics!.totalTime = Date.now() - this.startTime;
      result.success = true;

      this.log(`\n🎉 Deployment Completed Successfully!`, options.verbose);
      this.printDeploymentSummary(result, options.verbose);

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.metrics!.totalTime = Date.now() - this.startTime;

      this.log(`\n❌ Deployment Failed: ${result.error}`, true);
      this.printDeploymentSummary(result, options.verbose);

      return result;
    }
  }

  /**
   * Pre-deployment validation
   */
  private async preDeploymentValidation(
    options: DeploymentOptions,
    result: DeploymentResult
  ): Promise<void> {
    // Check Solana CLI availability
    try {
      execSync("solana --version", { stdio: "ignore" });
      this.log("✓ Solana CLI available", options.verbose);
    } catch {
      throw new Error("Solana CLI not found. Please install Solana CLI first.");
    }

    // Check Anchor CLI availability
    try {
      execSync("anchor --version", { stdio: "ignore" });
      this.log("✓ Anchor CLI available", options.verbose);
    } catch {
      throw new Error("Anchor CLI not found. Please install Anchor CLI first.");
    }

    // Validate network configuration
    const isValid = await this.networkManager.validateNetwork(options.network);
    if (!isValid) {
      throw new Error(`Network ${options.network} failed validation checks`);
    }

    // Check workspace is clean (optional warning)
    try {
      const gitStatus = execSync("git status --porcelain", {
        encoding: "utf8",
        stdio: "pipe",
      });
      if (gitStatus.trim()) {
        result.warnings?.push("Working directory has uncommitted changes");
        this.log(
          "⚠️  Warning: Working directory has uncommitted changes",
          options.verbose
        );
      }
    } catch {
      // Git not available or not a git repo - that's fine
    }

    this.log("✓ Pre-deployment validation passed", options.verbose);
  }

  /**
   * Prepare network for deployment
   */
  private async prepareNetwork(
    options: DeploymentOptions,
    result: DeploymentResult
  ): Promise<void> {
    await this.networkManager.prepareNetwork(options.network);
    this.log(`✓ Network ${options.network} prepared`, options.verbose);
  }

  /**
   * Build the Anchor program
   */
  private async buildProgram(
    options: DeploymentOptions,
    result: DeploymentResult
  ): Promise<void> {
    const buildStart = Date.now();

    try {
      // Clean previous build artifacts
      this.log("🧹 Cleaning previous build...", options.verbose);
      execSync("anchor clean", {
        stdio: options.verbose ? "inherit" : "ignore",
      });

      // Build the program
      this.log("🔨 Building Anchor program...", options.verbose);
      execSync("anchor build", {
        stdio: options.verbose ? "inherit" : "pipe",
        encoding: "utf8",
      });

      // Get program size
      const programPath = "target/deploy/message_gateway_v4.so";
      if (fs.existsSync(programPath)) {
        const stats = fs.statSync(programPath);
        result.metrics!.programSize = stats.size;
        this.log(
          `📏 Program size: ${(stats.size / 1024).toFixed(2)} KB`,
          options.verbose
        );
      }

      result.metrics!.buildTime = Date.now() - buildStart;
      this.log(
        `✓ Build completed in ${result.metrics!.buildTime}ms`,
        options.verbose
      );
    } catch (error) {
      throw new Error(`Build failed: ${error}`);
    }
  }

  /**
   * Deploy program to the network
   */
  private async deployProgram(
    options: DeploymentOptions,
    result: DeploymentResult
  ): Promise<void> {
    const deployStart = Date.now();

    try {
      // Build deployment command
      let deployCmd = `anchor deploy --provider.cluster ${options.network}`;

      // Add program-specific keypair if specified
      if (options.programKeypair) {
        deployCmd += ` --program-keypair ${options.programKeypair}`;
      }

      this.log(`🚀 Executing: ${deployCmd}`, options.verbose);

      // Execute deployment
      const deployOutput = execSync(deployCmd, {
        encoding: "utf8",
        stdio: "pipe", // Always pipe to capture output for parsing
      }) as string;

      // Show output if verbose
      if (options.verbose) {
        console.log(deployOutput);
      }

      // Parse deployment output for program ID and transaction signature
      result.programId = this.extractProgramId(deployOutput || "");
      result.txSignature = this.extractTxSignature(deployOutput || "");

      result.metrics!.deployTime = Date.now() - deployStart;
      this.log(
        `✓ Deployment completed in ${result.metrics!.deployTime}ms`,
        options.verbose
      );

      if (result.programId) {
        this.log(
          `📍 Program deployed at: ${result.programId}`,
          options.verbose
        );
      }
      if (result.txSignature) {
        this.log(`🔗 Transaction: ${result.txSignature}`, options.verbose);
      }
    } catch (error) {
      throw new Error(`Deployment failed: ${error}`);
    }
  }

  /**
   * Post-deployment validation
   */
  private async postDeploymentValidation(
    options: DeploymentOptions,
    result: DeploymentResult
  ): Promise<void> {
    // Verify program is deployed and accessible
    if (result.programId) {
      try {
        const accountInfo = execSync(
          `solana account ${result.programId} --url ${this.getNetworkUrl(
            options.network
          )}`,
          { encoding: "utf8", stdio: "pipe" }
        );

        if (accountInfo.includes("Account not found")) {
          throw new Error("Program not found on network after deployment");
        }

        this.log("✓ Program verified on network", options.verbose);
      } catch (error) {
        result.warnings?.push(`Program verification failed: ${error}`);
      }
    }

    // Optional: Run basic smoke tests
    this.log("✓ Post-deployment validation completed", options.verbose);
  }

  /**
   * Extract program ID from deployment output
   */
  private extractProgramId(output: string): string | undefined {
    // The actual format from anchor deploy is: "Program Id: 51iCoA1rzbTfotxEadRhi5V2eMgWqwMVgnxuLeE3edEr"
    const match = output.match(/Program Id:\s*([A-Za-z0-9]{32,44})/);
    if (match) return match[1];

    // Fallback patterns
    const fallbackMatch = output.match(/Program ID:\s*([A-Za-z0-9]{32,44})/);
    return fallbackMatch ? fallbackMatch[1] : undefined;
  }

  /**
   * Extract transaction signature from deployment output
   */
  private extractTxSignature(output: string): string | undefined {
    // Try multiple patterns for signature
    const patterns = [
      /Signature: ([A-Za-z0-9]{87,88})/,
      /signature: ([A-Za-z0-9]{87,88})/i,
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) return match[1];
    }

    return undefined;
  }

  /**
   * Get network URL for a given network
   */
  private getNetworkUrl(network: string): string {
    return this.networkManager.getNetworkUrl(network);
  }

  /**
   * Print deployment summary
   */
  private printDeploymentSummary(
    result: DeploymentResult,
    verbose?: boolean
  ): void {
    console.log("\n" + "=".repeat(60));
    console.log("📊 DEPLOYMENT SUMMARY");
    console.log("=".repeat(60));
    console.log(`Network: ${result.network.toUpperCase()}`);
    console.log(`Status: ${result.success ? "✅ SUCCESS" : "❌ FAILED"}`);

    if (result.programId) {
      console.log(`Program ID: ${result.programId}`);
    }
    if (result.txSignature) {
      console.log(`Transaction: ${result.txSignature}`);
    }
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }

    // Metrics
    if (result.metrics) {
      console.log("\n📈 METRICS:");
      if (result.metrics.buildTime) {
        console.log(`  Build Time: ${result.metrics.buildTime}ms`);
      }
      if (result.metrics.deployTime) {
        console.log(`  Deploy Time: ${result.metrics.deployTime}ms`);
      }
      if (result.metrics.totalTime) {
        console.log(`  Total Time: ${result.metrics.totalTime}ms`);
      }
      if (result.metrics.programSize) {
        console.log(
          `  Program Size: ${(result.metrics.programSize / 1024).toFixed(2)} KB`
        );
      }
    }

    // Warnings
    if (result.warnings && result.warnings.length > 0) {
      console.log("\n⚠️  WARNINGS:");
      result.warnings.forEach((warning) => console.log(`  - ${warning}`));
    }

    console.log("=".repeat(60));
  }

  /**
   * Utility logging function
   */
  private log(message: string, verbose?: boolean): void {
    if (verbose) {
      console.log(message);
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const options = parseCliArgs(args);
  const deployer = new ViaDeploymentManager();
  const result = await deployer.deploy(options);

  process.exit(result.success ? 0 : 1);
}

function printUsage(): void {
  console.log("🚀 Via Labs V4 Multi-Network Deployment Tool");
  console.log("\nUsage:");
  console.log("  yarn deploy <network> [options]");
  console.log("\nNetworks:");
  console.log("  localnet, devnet, testnet, mainnet");
  console.log("\nOptions:");
  console.log("  --skip-pre-validation, --skip-build, --skip-post-validation");
  console.log("  --dry-run, --verbose, --program-keypair <path>");
}

function parseCliArgs(args: string[]): DeploymentOptions {
  const options: DeploymentOptions = { network: args[0] };

  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    switch (flag) {
      case "--skip-pre-validation":
        options.skipPreValidation = true;
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--skip-post-validation":
        options.skipPostValidation = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--program-keypair":
        options.programKeypair = args[++i];
        break;
      default:
        console.warn(`⚠️  Unknown option: ${flag}`);
    }
  }

  return options;
}

// Only run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { ViaDeploymentManager };
export type { DeploymentOptions, DeploymentResult };
