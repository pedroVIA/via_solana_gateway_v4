#!/usr/bin/env ts-node
/**
 * Network Manager - Program ID and Keypair Management
 *
 * This script manages program IDs and keypairs across different networks,
 * ensuring proper configuration and deployment preparation.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { Keypair } from "@solana/web3.js";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface NetworkConfig {
  networks: {
    [key: string]: {
      url: string;
      programId: string | null;
      keypairPath: string;
      commitment: string;
      cost: string;
      description: string;
    };
  };
  requirements: {
    [key: string]: {
      minBalance: string;
      validation: string[];
    };
  };
}

interface AnchorToml {
  [key: string]: any;
}

interface NetworkManagerOptions {
  configPath?: string;
  anchorTomlPath?: string;
  libRsPath?: string;
  projectRoot?: string;
}

class NetworkManager {
  private configPath: string;
  private config: NetworkConfig;
  private anchorTomlPath: string;
  private libRsPath: string;

  constructor(options: NetworkManagerOptions = {}) {
    const projectRoot = options.projectRoot || path.join(__dirname, "../..");

    this.configPath =
      options.configPath || path.join(__dirname, "network-config.json");
    this.anchorTomlPath =
      options.anchorTomlPath || path.join(projectRoot, "Anchor.toml");
    this.libRsPath =
      options.libRsPath ||
      path.join(projectRoot, "programs/message_gateway_v4/src/lib.rs");

    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        throw new Error(
          `Network configuration file not found: ${this.configPath}`
        );
      }

      const configData = fs.readFileSync(this.configPath, "utf8");
      this.config = JSON.parse(configData);

      // Validate config structure
      if (!this.config.networks || typeof this.config.networks !== "object") {
        throw new Error(
          "Invalid network configuration: missing networks section"
        );
      }

      if (
        !this.config.requirements ||
        typeof this.config.requirements !== "object"
      ) {
        throw new Error(
          "Invalid network configuration: missing requirements section"
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to load network configuration: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log("✅ Network configuration updated");
    } catch (error) {
      throw new Error(`Failed to save network configuration: ${error}`);
    }
  }

  /**
   * Generate a keypair for the specified network (only if it doesn't exist)
   */
  generateKeypair(network: string): string {
    if (!this.config.networks[network]) {
      throw new Error(`Unknown network: ${network}`);
    }

    const networkConfig = this.config.networks[network];
    const keypairPath = path.resolve(networkConfig.keypairPath);

    // Ensure target/deploy directory exists
    const deployDir = path.dirname(keypairPath);
    if (!fs.existsSync(deployDir)) {
      fs.mkdirSync(deployDir, { recursive: true });
    }

    // Check if keypair already exists
    if (fs.existsSync(keypairPath)) {
      console.log(`✅ Using existing keypair for ${network} at ${keypairPath}`);
      const existingProgramId = this.getKeypairAddress(keypairPath);

      // Update network configuration with existing program ID
      this.config.networks[network].programId = existingProgramId;
      this.saveConfig();

      console.log(`📍 Program ID: ${existingProgramId}`);
      return existingProgramId;
    }

    try {
      // Check if solana-keygen is available
      try {
        execSync("solana-keygen --version", { stdio: "ignore" });
      } catch {
        throw new Error(
          "solana-keygen not found. Please install Solana CLI first: https://docs.solana.com/cli/install-solana-cli-tools"
        );
      }

      // Generate keypair using solana-keygen
      console.log(`🔑 Generating new keypair for ${network}...`);
      execSync(`solana-keygen new --no-bip39-passphrase -o ${keypairPath}`, {
        stdio: "inherit",
      });

      // Verify keypair was created
      if (!fs.existsSync(keypairPath)) {
        throw new Error(
          `Keypair generation failed - file not created at ${keypairPath}`
        );
      }

      // Get the program ID from the new keypair
      const programId = this.getKeypairAddress(keypairPath);

      // Validate program ID format
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(programId)) {
        throw new Error(`Invalid program ID format: ${programId}`);
      }

      // Update network configuration
      this.config.networks[network].programId = programId;
      this.saveConfig();

      console.log(`✅ Generated keypair for ${network}`);
      console.log(`📍 Program ID: ${programId}`);
      console.log(`🗝️  Keypair saved to: ${keypairPath}`);

      return programId;
    } catch (error) {
      // Clean up partial files on error
      if (fs.existsSync(keypairPath)) {
        try {
          fs.unlinkSync(keypairPath);
          console.log(`🧹 Cleaned up incomplete keypair file`);
        } catch {
          // Ignore cleanup errors
        }
      }
      throw new Error(
        `Failed to generate keypair for ${network}: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  /**
   * Get program ID from keypair file
   */
  private getKeypairAddress(keypairPath: string): string {
    try {
      // Check if solana CLI is available
      try {
        execSync("solana --version", { stdio: "ignore" });
      } catch {
        throw new Error(
          "solana CLI not found. Please install Solana CLI first: https://docs.solana.com/cli/install-solana-cli-tools"
        );
      }

      // Check if keypair file exists and is readable
      if (!fs.existsSync(keypairPath)) {
        throw new Error(`Keypair file not found: ${keypairPath}`);
      }

      const result = execSync(`solana address -k ${keypairPath}`, {
        encoding: "utf8",
      });
      const address = result.trim();

      if (!address) {
        throw new Error("Empty address returned from solana CLI");
      }

      return address;
    } catch (error) {
      throw new Error(
        `Failed to get address from keypair ${keypairPath}: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  /**
   * Update Anchor.toml with network-specific program IDs
   */
  updateAnchorToml(network?: string): void {
    try {
      if (!fs.existsSync(this.anchorTomlPath)) {
        throw new Error(`Anchor.toml not found: ${this.anchorTomlPath}`);
      }

      let tomlContent = fs.readFileSync(this.anchorTomlPath, "utf8");
      const lines = tomlContent.split("\n");

      // Update specific network or all networks
      const networksToUpdate = network
        ? [network]
        : Object.keys(this.config.networks);

      for (const net of networksToUpdate) {
        const networkConfig = this.config.networks[net];
        if (!networkConfig.programId) continue;

        const sectionHeader = `[programs.${net}]`;
        const programLine = `message_gateway_v4 = "${networkConfig.programId}"`;

        // Find existing section
        const sectionIndex = lines.findIndex(
          (line) => line.trim() === sectionHeader
        );

        if (sectionIndex !== -1) {
          // Update existing section
          const nextSectionIndex = lines.findIndex(
            (line, idx) =>
              idx > sectionIndex && line.startsWith("[") && line.endsWith("]")
          );
          const endIndex =
            nextSectionIndex !== -1 ? nextSectionIndex : lines.length;

          // Find and update the program line within this section
          let programLineIndex = -1;
          for (let i = sectionIndex + 1; i < endIndex; i++) {
            if (lines[i].trim().startsWith("message_gateway_v4")) {
              programLineIndex = i;
              break;
            }
          }

          if (programLineIndex !== -1) {
            lines[programLineIndex] = programLine;
          } else {
            // Add program line after section header
            lines.splice(sectionIndex + 1, 0, programLine);
          }
        } else {
          // Add new section at the end
          lines.push("", sectionHeader, programLine);
        }
      }

      fs.writeFileSync(this.anchorTomlPath, lines.join("\n"));
      console.log(`✅ Updated Anchor.toml for ${networksToUpdate.join(", ")}`);
    } catch (error) {
      throw new Error(`Failed to update Anchor.toml: ${error}`);
    }
  }

  /**
   * Sync program ID using Anchor's native keys sync command
   */
  syncProgramId(): void {
    try {
      // Check if anchor CLI is available
      try {
        execSync("anchor --version", { stdio: "ignore" });
      } catch {
        throw new Error(
          "Anchor CLI not found. Please install Anchor CLI first."
        );
      }

      console.log("🔑 Syncing program ID using Anchor native method...");

      // Use Anchor's native sync command to update declare_id! in lib.rs
      execSync(`anchor keys sync --program-name message_gateway_v4`, {
        cwd: path.join(__dirname, "../.."), // Project root
        stdio: "inherit",
      });

      console.log(`✅ Program ID synced using Anchor native method`);
    } catch (error) {
      throw new Error(
        `Failed to sync program ID: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  /**
   * List all network configurations
   */
  listNetworks(): void {
    console.log("\n🌐 Available Networks:");
    console.log("═".repeat(80));

    for (const [name, config] of Object.entries(this.config.networks)) {
      console.log(`\n📍 ${name.toUpperCase()}`);
      console.log(`   URL: ${config.url}`);
      console.log(`   Program ID: ${config.programId || "Not generated"}`);
      console.log(`   Keypair: ${config.keypairPath}`);
      console.log(`   Cost: ${config.cost}`);
      console.log(`   Description: ${config.description}`);
    }
    console.log("\n");
  }

  /**
   * Validate network requirements
   */
  async validateNetwork(network: string): Promise<boolean> {
    if (!this.config.networks[network]) {
      throw new Error(`Unknown network: ${network}`);
    }

    const networkConfig = this.config.networks[network];
    const requirements = this.config.requirements[network];

    console.log(
      `\n🔍 Validating ${network.toUpperCase()} deployment requirements...`
    );

    let allValid = true;

    for (const validation of requirements.validation) {
      switch (validation) {
        case "keypair_exists":
          const keypairExists = fs.existsSync(networkConfig.keypairPath);
          console.log(`   ✓ Keypair exists: ${keypairExists ? "✅" : "❌"}`);
          if (!keypairExists) allValid = false;
          break;

        case "network_reachable":
          try {
            execSync(`solana cluster-version --url ${networkConfig.url}`, {
              stdio: "ignore",
            });
            console.log(`   ✓ Network reachable: ✅`);
          } catch {
            console.log(`   ✓ Network reachable: ❌`);
            allValid = false;
          }
          break;

        case "sufficient_balance":
          console.log(
            `   ⚠️  Balance check requires manual verification (${requirements.minBalance})`
          );
          break;

        default:
          console.log(`   ⚠️  ${validation}: Manual verification required`);
      }
    }

    return allValid;
  }

  /**
   * Get network URL for a given network
   */
  getNetworkUrl(network: string): string {
    if (this.config.networks[network]) {
      return this.config.networks[network].url;
    }
    return "http://127.0.0.1:8899"; // Default to localnet
  }

  /**
   * Prepare network for deployment
   */
  async prepareNetwork(network: string): Promise<void> {
    console.log(`\n🚀 Preparing ${network.toUpperCase()} for deployment...`);

    // Generate keypair if it doesn't exist
    const networkConfig = this.config.networks[network];
    if (!networkConfig.programId || !fs.existsSync(networkConfig.keypairPath)) {
      console.log("📝 Generating new keypair...");
      this.generateKeypair(network);
    }

    // Update Anchor.toml
    this.updateAnchorToml(network);

    // Sync program ID using Anchor's native method
    this.syncProgramId();

    // Validate requirements
    const isValid = await this.validateNetwork(network);

    if (isValid) {
      console.log(`✅ ${network.toUpperCase()} is ready for deployment!`);
    } else {
      console.log(
        `⚠️  ${network.toUpperCase()} has validation issues. Please resolve them before deployment.`
      );
    }
  }
}

// CLI Interface
async function main() {
  const manager = new NetworkManager();
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  try {
    await executeCommand(manager, args[0], args[1]);
  } catch (error) {
    console.error(`❌ Error: ${error}`);
    process.exit(1);
  }
}

function printUsage(): void {
  console.log("📋 Via Labs V4 Network Manager");
  console.log("\nCommands:");
  console.log(
    "  list, generate <network>, prepare <network>, validate <network>, update-config"
  );
}

async function executeCommand(
  manager: NetworkManager,
  command: string,
  network?: string
): Promise<void> {
  switch (command) {
    case "list":
      manager.listNetworks();
      break;
    case "generate":
      if (!network) throw new Error("Network name required");
      manager.generateKeypair(network);
      break;
    case "prepare":
      if (!network) throw new Error("Network name required");
      await manager.prepareNetwork(network);
      break;
    case "validate":
      if (!network) throw new Error("Network name required");
      await manager.validateNetwork(network);
      break;
    case "update-config":
      manager.updateAnchorToml();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Only run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { NetworkManager };
