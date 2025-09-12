#!/usr/bin/env ts-node
/**
 * Environment Configuration Manager
 *
 * Manages environment-specific configurations for different networks
 * and deployment scenarios.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface EnvironmentConfig {
  // Network Configuration
  ANCHOR_PROVIDER_URL: string;
  ANCHOR_WALLET: string;
  NETWORK: string;

  // Program Configuration
  PROGRAM_ID?: string;
  PROGRAM_KEYPAIR?: string;

  // Deployment Configuration
  DEPLOYMENT_COST_LIMIT?: string;
  DEPLOYMENT_TIMEOUT?: string;
  SKIP_CONFIRMATION?: string;

  // Security Configuration
  UPGRADE_AUTHORITY?: string;
  MULTISIG_THRESHOLD?: string;

  // Testing Configuration
  SKIP_PREFLIGHT?: string;
  COMMITMENT_LEVEL?: string;

  // Logging Configuration
  LOG_LEVEL?: string;
  VERBOSE_DEPLOYMENT?: string;

  // Custom Configuration
  [key: string]: string | undefined;
}

interface EnvironmentProfile {
  name: string;
  description: string;
  config: EnvironmentConfig;
  required: string[];
  optional: string[];
  warnings?: string[];
}

class EnvironmentManager {
  private profiles: { [key: string]: EnvironmentProfile } = {};
  private envPath: string;
  private templatePath: string;

  constructor() {
    this.envPath = path.resolve(".env");
    this.templatePath = path.resolve(".env.template");
    this.initializeProfiles();
  }

  /**
   * Initialize environment profiles for different networks
   */
  private initializeProfiles(): void {
    this.profiles = {
      localnet: this.createLocalnetProfile(),
      devnet: this.createDevnetProfile(),
      testnet: this.createTestnetProfile(),
      mainnet: this.createMainnetProfile(),
      custom: this.createCustomProfile(),
    };
  }

  private createLocalnetProfile(): EnvironmentProfile {
    return {
      name: "Local Development",
      description: "Local Solana test validator configuration",
      config: {
        ANCHOR_PROVIDER_URL: "http://127.0.0.1:8899",
        ANCHOR_WALLET: "~/.config/solana/id.json",
        NETWORK: "localnet",
        PROGRAM_ID: "FkYFDWxJjG1wR5AgDvigHpzm79RHh5s1Ng9T6N96v2g7",
        PROGRAM_KEYPAIR: "target/deploy/message_gateway_v4-keypair.json",
        SKIP_PREFLIGHT: "false",
        COMMITMENT_LEVEL: "confirmed",
        LOG_LEVEL: "info",
        VERBOSE_DEPLOYMENT: "true",
      },
      required: ["ANCHOR_PROVIDER_URL", "ANCHOR_WALLET", "NETWORK"],
      optional: ["PROGRAM_ID", "PROGRAM_KEYPAIR", "LOG_LEVEL"],
    };
  }

  private createDevnetProfile(): EnvironmentProfile {
    return {
      name: "Devnet Testing",
      description: "Solana Devnet configuration for testing",
      config: {
        ANCHOR_PROVIDER_URL: "https://api.devnet.solana.com",
        ANCHOR_WALLET: "~/.config/solana/id.json",
        NETWORK: "devnet",
        PROGRAM_KEYPAIR: "target/deploy/message_gateway_v4-devnet-keypair.json",
        DEPLOYMENT_COST_LIMIT: "2.0",
        DEPLOYMENT_TIMEOUT: "60000",
        SKIP_CONFIRMATION: "false",
        SKIP_PREFLIGHT: "false",
        COMMITMENT_LEVEL: "confirmed",
        LOG_LEVEL: "info",
        VERBOSE_DEPLOYMENT: "true",
      },
      required: [
        "ANCHOR_PROVIDER_URL",
        "ANCHOR_WALLET",
        "NETWORK",
        "PROGRAM_KEYPAIR",
      ],
      optional: ["PROGRAM_ID", "DEPLOYMENT_COST_LIMIT", "LOG_LEVEL"],
      warnings: ["Ensure you have sufficient devnet SOL for deployment"],
    };
  }

  private createTestnetProfile(): EnvironmentProfile {
    return {
      name: "Testnet Validation",
      description: "Solana Testnet configuration for final validation",
      config: {
        ANCHOR_PROVIDER_URL: "https://api.testnet.solana.com",
        ANCHOR_WALLET: "~/.config/solana/id.json",
        NETWORK: "testnet",
        PROGRAM_KEYPAIR:
          "target/deploy/message_gateway_v4-testnet-keypair.json",
        DEPLOYMENT_COST_LIMIT: "2.0",
        DEPLOYMENT_TIMEOUT: "120000",
        SKIP_CONFIRMATION: "false",
        SKIP_PREFLIGHT: "false",
        COMMITMENT_LEVEL: "confirmed",
        LOG_LEVEL: "info",
        VERBOSE_DEPLOYMENT: "true",
      },
      required: [
        "ANCHOR_PROVIDER_URL",
        "ANCHOR_WALLET",
        "NETWORK",
        "PROGRAM_KEYPAIR",
      ],
      optional: ["PROGRAM_ID", "DEPLOYMENT_COST_LIMIT", "UPGRADE_AUTHORITY"],
      warnings: ["Ensure you have sufficient testnet SOL for deployment"],
    };
  }

  private createMainnetProfile(): EnvironmentProfile {
    return {
      name: "Production Mainnet",
      description: "Solana Mainnet production configuration",
      config: {
        ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
        ANCHOR_WALLET: "~/.config/solana/id.json",
        NETWORK: "mainnet",
        PROGRAM_KEYPAIR:
          "target/deploy/message_gateway_v4-mainnet-keypair.json",
        DEPLOYMENT_COST_LIMIT: "10.0",
        DEPLOYMENT_TIMEOUT: "300000",
        SKIP_CONFIRMATION: "false",
        SKIP_PREFLIGHT: "false",
        COMMITMENT_LEVEL: "finalized",
        LOG_LEVEL: "warn",
        VERBOSE_DEPLOYMENT: "true",
        MULTISIG_THRESHOLD: "2",
      },
      required: [
        "ANCHOR_PROVIDER_URL",
        "ANCHOR_WALLET",
        "NETWORK",
        "PROGRAM_KEYPAIR",
        "UPGRADE_AUTHORITY",
      ],
      optional: ["DEPLOYMENT_COST_LIMIT", "MULTISIG_THRESHOLD"],
      warnings: [
        "PRODUCTION DEPLOYMENT - Costs 3-5 SOL",
        "Ensure upgrade authority is properly configured",
        "Consider using multisig for upgrade authority",
        "Backup your keypair securely before deployment",
      ],
    };
  }

  private createCustomProfile(): EnvironmentProfile {
    return {
      name: "Custom Configuration",
      description: "User-defined custom configuration",
      config: {},
      required: ["ANCHOR_PROVIDER_URL", "NETWORK"],
      optional: [],
    };
  }

  /**
   * List all available environment profiles
   */
  listProfiles(): void {
    console.log("\n🌍 Available Environment Profiles:");
    console.log("═".repeat(70));

    for (const [key, profile] of Object.entries(this.profiles)) {
      console.log(`\n📋 ${key.toUpperCase()}`);
      console.log(`   Name: ${profile.name}`);
      console.log(`   Description: ${profile.description}`);
      console.log(`   Required: ${profile.required.join(", ")}`);
      if (profile.optional.length > 0) {
        console.log(`   Optional: ${profile.optional.join(", ")}`);
      }
      if (profile.warnings && profile.warnings.length > 0) {
        console.log(`   ⚠️  Warnings: ${profile.warnings.length} item(s)`);
      }
    }
    console.log("\n");
  }

  /**
   * Generate environment configuration for a specific profile
   */
  generateConfig(profileName: string, outputPath?: string): void {
    const profile = this.profiles[profileName];
    if (!profile) {
      throw new Error(`Unknown profile: ${profileName}`);
    }

    const targetPath = outputPath || this.envPath;

    // Generate .env content
    let content = `# Via Labs V4 Environment Configuration\n`;
    content += `# Profile: ${profile.name}\n`;
    content += `# Generated: ${new Date().toISOString()}\n\n`;

    if (profile.description) {
      content += `# ${profile.description}\n\n`;
    }

    // Add warnings
    if (profile.warnings && profile.warnings.length > 0) {
      content += `# ⚠️  WARNINGS:\n`;
      profile.warnings.forEach((warning) => {
        content += `# - ${warning}\n`;
      });
      content += "\n";
    }

    // Add required configuration
    content += `# Required Configuration\n`;
    profile.required.forEach((key) => {
      const value = profile.config[key] || "";
      content += `${key}=${value}\n`;
    });

    // Add optional configuration
    if (profile.optional.length > 0) {
      content += `\n# Optional Configuration\n`;
      profile.optional.forEach((key) => {
        const value = profile.config[key] || "";
        content += `${key}=${value}\n`;
      });
    }

    // Add any other config not in required/optional
    const documented = new Set([...profile.required, ...profile.optional]);
    const other = Object.entries(profile.config).filter(
      ([key]) => !documented.has(key)
    );

    if (other.length > 0) {
      content += `\n# Additional Configuration\n`;
      other.forEach(([key, value]) => {
        content += `${key}=${value || ""}\n`;
      });
    }

    // Write file
    try {
      fs.writeFileSync(targetPath, content);
      console.log(`✅ Generated ${profile.name} configuration:`);
      console.log(`   📄 File: ${targetPath}`);
      console.log(`   🔧 Profile: ${profileName}`);

      if (profile.warnings && profile.warnings.length > 0) {
        console.log(`\n⚠️  Important Warnings:`);
        profile.warnings.forEach((warning) => console.log(`   - ${warning}`));
      }
    } catch (error) {
      throw new Error(`Failed to write configuration: ${error}`);
    }
  }

  /**
   * Validate current environment configuration
   */
  validateConfig(profileName?: string): boolean {
    let profile: EnvironmentProfile | undefined;

    if (profileName) {
      profile = this.profiles[profileName];
      if (!profile) {
        throw new Error(`Unknown profile: ${profileName}`);
      }
    } else {
      // Try to detect profile from current .env
      if (fs.existsSync(this.envPath)) {
        const currentEnv = this.loadEnvFile(this.envPath);
        const network = currentEnv.NETWORK;
        if (network && this.profiles[network]) {
          profile = this.profiles[network];
          profileName = network;
        }
      }
    }

    if (!profile) {
      console.log(
        "❌ No profile specified and could not detect from .env file"
      );
      return false;
    }

    console.log(`\n🔍 Validating ${profile.name} configuration...`);

    // Load current environment
    const currentEnv = this.loadEnvFile(this.envPath);
    let valid = true;

    // Check required fields
    console.log("\n📋 Required Configuration:");
    for (const key of profile.required) {
      const value = currentEnv[key];
      const status = value ? "✅" : "❌";
      console.log(`   ${key}: ${status} ${value || "MISSING"}`);
      if (!value) valid = false;
    }

    // Check optional fields
    if (profile.optional.length > 0) {
      console.log("\n⚙️  Optional Configuration:");
      for (const key of profile.optional) {
        const value = currentEnv[key];
        const status = value ? "✅" : "⚪";
        console.log(`   ${key}: ${status} ${value || "not set"}`);
      }
    }

    // File-based validations
    console.log("\n📁 File Validations:");
    if (currentEnv.PROGRAM_KEYPAIR) {
      const keypairExists = fs.existsSync(currentEnv.PROGRAM_KEYPAIR);
      console.log(
        `   Keypair exists: ${keypairExists ? "✅" : "❌"} ${
          currentEnv.PROGRAM_KEYPAIR
        }`
      );
      if (!keypairExists) valid = false;
    }

    if (currentEnv.ANCHOR_WALLET) {
      const walletPath = currentEnv.ANCHOR_WALLET.replace("~", os.homedir());
      const walletExists = fs.existsSync(walletPath);
      console.log(
        `   Wallet exists: ${walletExists ? "✅" : "❌"} ${
          currentEnv.ANCHOR_WALLET
        }`
      );
      if (!walletExists) valid = false;
    }

    // Network connectivity (basic check)
    console.log("\n🌐 Network Configuration:");
    if (currentEnv.ANCHOR_PROVIDER_URL) {
      console.log(`   Provider URL: ✅ ${currentEnv.ANCHOR_PROVIDER_URL}`);
      // TODO: Add actual connectivity test
    }

    console.log(`\n📊 Validation Result: ${valid ? "✅ PASSED" : "❌ FAILED"}`);
    return valid;
  }

  /**
   * Load environment file into object
   */
  private loadEnvFile(filePath: string): { [key: string]: string } {
    const env: { [key: string]: string } = {};

    if (!fs.existsSync(filePath)) {
      return env;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts.join("=").trim();
        }
      }
    }

    return env;
  }

  /**
   * Create environment template file
   */
  createTemplate(): void {
    let content = `# Via Labs V4 Environment Template\n`;
    content += `# Copy this file to .env and configure for your environment\n\n`;

    for (const [profileName, profile] of Object.entries(this.profiles)) {
      if (profileName === "custom") continue;

      content += `# ─────────────────────────────────────────────────────\n`;
      content += `# ${profile.name.toUpperCase()} CONFIGURATION\n`;
      content += `# ${profile.description}\n`;
      content += `# ─────────────────────────────────────────────────────\n`;

      if (profile.warnings) {
        content += "# WARNINGS:\n";
        profile.warnings.forEach(
          (warning) => (content += `#   - ${warning}\n`)
        );
        content += "\n";
      }

      Object.entries(profile.config).forEach(([key, value]) => {
        content += `# ${key}=${value}\n`;
      });
      content += "\n";
    }

    fs.writeFileSync(this.templatePath, content);
    console.log(`✅ Generated environment template: ${this.templatePath}`);
  }

  /**
   * Switch to a different environment profile
   */
  switchProfile(profileName: string): void {
    // Backup current .env if it exists
    if (fs.existsSync(this.envPath)) {
      const backupPath = `.env.backup.${Date.now()}`;
      fs.copyFileSync(this.envPath, backupPath);
      console.log(`📁 Backed up current .env to: ${backupPath}`);
    }

    // Generate new configuration
    this.generateConfig(profileName);
    console.log(`🔄 Switched to ${profileName} profile`);
  }
}

// CLI Interface
async function main() {
  const manager = new EnvironmentManager();
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
  console.log("🌍 Via Labs V4 Environment Manager");
  console.log("\nCommands:");
  console.log(
    "  list, generate <profile>, validate [profile], switch <profile>, template"
  );
  console.log("\nProfiles: localnet, devnet, testnet, mainnet");
}

async function executeCommand(
  manager: EnvironmentManager,
  command: string,
  profile?: string
): Promise<void> {
  switch (command) {
    case "list":
      manager.listProfiles();
      break;
    case "generate":
      if (!profile) throw new Error("Profile name required");
      manager.generateConfig(profile);
      break;
    case "validate":
      manager.validateConfig(profile);
      break;
    case "switch":
      if (!profile) throw new Error("Profile name required");
      manager.switchProfile(profile);
      break;
    case "template":
      manager.createTemplate();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { EnvironmentManager };
