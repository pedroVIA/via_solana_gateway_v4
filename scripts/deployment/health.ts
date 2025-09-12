#!/usr/bin/env ts-node
/**
 * Deployment Health Check System
 *
 * Continuous monitoring and health checks for deployed Via Labs V4 Message Gateway.
 * Provides real-time status monitoring, alerting, and health metrics.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { MessageGatewayV4 } from "../../target/types/message_gateway_v4";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { BN } from "bn.js";

// ES module equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface HealthCheckResult {
  timestamp: number;
  overall: "healthy" | "degraded" | "unhealthy";
  services: ServiceHealth[];
  metrics: HealthMetrics;
  alerts: Alert[];
}

interface ServiceHealth {
  name: string;
  status: "up" | "down" | "degraded";
  lastCheck: number;
  responseTime: number;
  uptime: number;
  details?: any;
  error?: string;
}

interface HealthMetrics {
  networkLatency: number;
  programAvailability: number;
  gatewayCount: number;
  registryCount: number;
  errorRate: number;
  lastDeployment: number;
}

interface Alert {
  level: "info" | "warning" | "error" | "critical";
  message: string;
  timestamp: number;
  service?: string;
}

interface HealthConfig {
  programId: string;
  networkUrl: string;
  walletPath: string;
  checkInterval: number; // milliseconds
  thresholds: {
    responseTime: number; // ms
    errorRate: number; // percentage
    uptime: number; // percentage
  };
  monitoredChains: number[];
  enableContinuous: boolean;
  outputFormat: "console" | "json" | "prometheus";
}

class HealthCheckService {
  private connection: Connection;
  private program!: Program<MessageGatewayV4>;
  private provider: AnchorProvider;
  private authority: Keypair;
  private config: HealthConfig;
  private isRunning = false;
  private checkCount = 0;
  private errorCount = 0;
  private startTime = Date.now();

  constructor(config: HealthConfig) {
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
    // Create a minimal IDL that bypasses account namespace creation entirely
    // This is the nuclear option that definitively solves the .size property error
    const minimalIdl = {
      address: this.config.programId,
      metadata: {
        name: "message_gateway_v4",
        version: "0.1.0",
        spec: "0.1.0"
      },
      instructions: [], // Empty - we don't need instruction parsing for health checks
      accounts: [],     // Empty - this prevents AccountClient instantiation 
      types: [],        // Empty - no type parsing needed
      events: [],       // Empty - no event parsing needed
      errors: []        // Empty - no error parsing needed
    };
    
    return new Program(
      minimalIdl as any,
      new PublicKey(this.config.programId),
      this.provider
    );
  }

  /**
   * Utility methods for PDA creation
   */
  private async getGatewayPDA(chainId: number): Promise<PublicKey> {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("gateway"), new BN(chainId).toArrayLike(Buffer, "le", 8)],
      this.program.programId
    );
    return pda;
  }

  private async getRegistryPDA(
    registryType: string,
    chainId: number
  ): Promise<PublicKey> {
    const discriminant = this.getRegistryTypeDiscriminant(registryType);
    const [pda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("signer_registry"),
        new BN(discriminant).toArrayLike(Buffer, "le", 1),
        new BN(chainId).toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );
    return pda;
  }

  /**
   * Start continuous health monitoring
   */
  async startMonitoring(): Promise<void> {
    if (this.isRunning) {
      console.log("⚠️  Health monitoring is already running");
      return;
    }

    this.isRunning = true;
    console.log("🏥 Starting Health Check Service...");
    console.log(`📍 Program ID: ${this.config.programId}`);
    console.log(`🌐 Network: ${this.config.networkUrl}`);
    console.log(`⏱️  Check Interval: ${this.config.checkInterval / 1000}s`);
    console.log(`📊 Output Format: ${this.config.outputFormat}`);

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("\n🛑 Shutting down health monitoring...");
      this.stopMonitoring();
    });

    process.on("SIGTERM", () => {
      console.log("\n🛑 Received termination signal...");
      this.stopMonitoring();
    });

    // Initial health check
    await this.performHealthCheck();

    if (this.config.enableContinuous) {
      // Start continuous monitoring
      const intervalId = setInterval(async () => {
        if (!this.isRunning) {
          clearInterval(intervalId);
          return;
        }
        await this.performHealthCheck();
      }, this.config.checkInterval);
    }
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    this.isRunning = false;
    const uptime = (Date.now() - this.startTime) / 1000 / 60; // minutes
    const successRate = (
      ((this.checkCount - this.errorCount) / this.checkCount) *
      100
    ).toFixed(2);

    console.log("\n📊 Health Monitoring Summary:");
    console.log(`   Uptime: ${uptime.toFixed(2)} minutes`);
    console.log(`   Total Checks: ${this.checkCount}`);
    console.log(`   Success Rate: ${successRate}%`);
    console.log(`   Errors: ${this.errorCount}`);
    process.exit(0);
  }

  /**
   * Perform a single health check
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    this.checkCount++;

    const result: HealthCheckResult = {
      timestamp: startTime,
      overall: "healthy",
      services: [],
      metrics: {
        networkLatency: 0,
        programAvailability: 0,
        gatewayCount: 0,
        registryCount: 0,
        errorRate: 0,
        lastDeployment: 0,
      },
      alerts: [],
    };

    try {
      // Check network connectivity
      await this.checkNetworkHealth(result);

      // Check program availability
      await this.checkProgramHealth(result);

      // Check gateway accounts
      await this.checkGatewayHealth(result);

      // Check signer registries
      await this.checkRegistryHealth(result);

      // Calculate overall health
      this.calculateOverallHealth(result);

      // Output results
      this.outputHealthResults(result);

      return result;
    } catch (error) {
      this.errorCount++;
      const errorMsg = error instanceof Error ? error.message : String(error);

      result.overall = "unhealthy";
      result.alerts.push({
        level: "critical",
        message: `Health check failed: ${errorMsg}`,
        timestamp: Date.now(),
      });

      console.error(`❌ Health check failed: ${errorMsg}`);
      this.outputHealthResults(result);

      return result;
    }
  }

  /**
   * Check network connectivity health
   */
  private async checkNetworkHealth(result: HealthCheckResult): Promise<void> {
    const startTime = Date.now();

    try {
      // Test basic connectivity
      const version = await this.connection.getVersion();
      const latency = Date.now() - startTime;

      const service: ServiceHealth = {
        name: "network",
        status:
          latency < this.config.thresholds.responseTime ? "up" : "degraded",
        lastCheck: Date.now(),
        responseTime: latency,
        uptime: 100, // TODO: Calculate actual uptime
        details: {
          solanaCore: version["solana-core"],
          featureSet: version["feature-set"],
        },
      };

      if (latency > this.config.thresholds.responseTime) {
        result.alerts.push({
          level: "warning",
          message: `High network latency: ${latency}ms`,
          timestamp: Date.now(),
          service: "network",
        });
      }

      result.services.push(service);
      result.metrics.networkLatency = latency;
    } catch (error) {
      result.services.push({
        name: "network",
        status: "down",
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
        uptime: 0,
        error: error instanceof Error ? error.message : String(error),
      });

      result.alerts.push({
        level: "critical",
        message: `Network connectivity failed: ${error}`,
        timestamp: Date.now(),
        service: "network",
      });
    }
  }

  /**
   * Check program availability
   */
  private async checkProgramHealth(result: HealthCheckResult): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if program account exists and is executable
      const accountInfo = await this.connection.getAccountInfo(
        this.program.programId
      );
      const responseTime = Date.now() - startTime;

      if (!accountInfo || !accountInfo.executable) {
        throw new Error("Program not found or not executable");
      }

      // Test program IDL accessibility
      const methods = Object.keys(this.program.methods);

      result.services.push({
        name: "program",
        status: "up",
        lastCheck: Date.now(),
        responseTime,
        uptime: 100, // TODO: Calculate actual uptime
        details: {
          executable: accountInfo.executable,
          dataLength: accountInfo.data.length,
          methods: methods.length,
          owner: accountInfo.owner.toString(),
        },
      });

      result.metrics.programAvailability = 100;
    } catch (error) {
      result.services.push({
        name: "program",
        status: "down",
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
        uptime: 0,
        error: error instanceof Error ? error.message : String(error),
      });

      result.alerts.push({
        level: "critical",
        message: `Program unavailable: ${error}`,
        timestamp: Date.now(),
        service: "program",
      });

      result.metrics.programAvailability = 0;
    }
  }

  /**
   * Check gateway account health
   */
  private async checkGatewayHealth(result: HealthCheckResult): Promise<void> {
    let healthyGateways = 0;
    let totalGateways = 0;

    for (const chainId of this.config.monitoredChains) {
      const startTime = Date.now();
      totalGateways++;

      try {
        const gatewayPDA = await this.getGatewayPDA(chainId);
        const accountInfo = await this.connection.getAccountInfo(gatewayPDA);
        const responseTime = Date.now() - startTime;

        if (!accountInfo) {
          throw new Error(`Gateway account not found`);
        }

        // Parse MessageGateway: discriminator(8) + authority(32) + chain_id(8) + system_enabled(1) + bump(1)
        const data = accountInfo.data;
        if (data.length < 50) {
          throw new Error(`Invalid gateway account data length: ${data.length}`);
        }

        const authority = new PublicKey(data.slice(8, 40));
        const parsedChainId = data.readBigUInt64LE(40);
        const systemEnabled = data[48] === 1;

        const isHealthy = systemEnabled;
        if (isHealthy) healthyGateways++;

        result.services.push({
          name: `gateway-chain-${parsedChainId}`,
          status: isHealthy ? "up" : "degraded",
          lastCheck: Date.now(),
          responseTime,
          uptime: 100, // TODO: Calculate actual uptime
          details: {
            chainId: parsedChainId.toString(),
            authority: authority.toString(),
            systemEnabled: systemEnabled,
            address: gatewayPDA.toString(),
          },
        });

        if (!isHealthy) {
          result.alerts.push({
            level: "warning",
            message: `Gateway for chain ${chainId} is disabled`,
            timestamp: Date.now(),
            service: `gateway-chain-${chainId}`,
          });
        }
      } catch (error) {
        result.services.push({
          name: `gateway-chain-${chainId}`,
          status: "down",
          lastCheck: Date.now(),
          responseTime: Date.now() - startTime,
          uptime: 0,
          error: error instanceof Error ? error.message : String(error),
        });

        result.alerts.push({
          level: "error",
          message: `Gateway for chain ${chainId} not found or inaccessible: ${error}`,
          timestamp: Date.now(),
          service: `gateway-chain-${chainId}`,
        });
      }
    }

    result.metrics.gatewayCount = healthyGateways;
  }

  /**
   * Check signer registry health
   */
  private async checkRegistryHealth(result: HealthCheckResult): Promise<void> {
    let healthyRegistries = 0;
    const registryTypes = ["VIA", "Chain"]; // Only check required registries

    for (const chainId of this.config.monitoredChains) {
      for (const registryType of registryTypes) {
        const startTime = Date.now();

        try {
          const registryPDA = await this.getRegistryPDA(registryType, chainId);
          const accountInfo = await this.connection.getAccountInfo(registryPDA);
          const responseTime = Date.now() - startTime;

          if (!accountInfo) {
            throw new Error(`Registry account not found`);
          }

          // Parse SignerRegistry: discriminator(8) + registry_type(1) + authority(32) + signers_vec_len(4) + signers + required_signatures(1) + chain_id(8) + enabled(1) + bump(1)
          const data = accountInfo.data;
          if (data.length < 56) { // Minimum: 8 + 1 + 32 + 4 + 0 + 1 + 8 + 1 + 1 = 56
            throw new Error(`Invalid registry account data length: ${data.length}`);
          }

          // Parse the account data manually
          const registryTypeValue = data[8];
          const authority = new PublicKey(data.slice(9, 41));
          const signersLength = data.readUInt32LE(41);
          const signersEndOffset = 45 + (signersLength * 32);
          const requiredSignatures = data[signersEndOffset];
          const parsedChainId = data.readBigUInt64LE(signersEndOffset + 1);
          const enabled = data[signersEndOffset + 9] === 1;

          const isHealthy = enabled && signersLength > 0;
          if (isHealthy) healthyRegistries++;

          result.services.push({
            name: `registry-${registryType.toLowerCase()}-chain-${parsedChainId}`,
            status: isHealthy ? "up" : "degraded",
            lastCheck: Date.now(),
            responseTime,
            uptime: 100, // TODO: Calculate actual uptime
            details: {
              type: registryType,
              chainId: parsedChainId,
              signerCount: signersLength,
              threshold: requiredSignatures,
              enabled: enabled,
              address: registryPDA.toString(),
            },
          });

          if (!isHealthy) {
            result.alerts.push({
              level: "warning",
              message: `${registryType} registry for chain ${chainId} is disabled or has no signers`,
              timestamp: Date.now(),
              service: `registry-${registryType.toLowerCase()}-chain-${chainId}`,
            });
          }
        } catch (error) {
          result.services.push({
            name: `registry-${registryType.toLowerCase()}-chain-${chainId}`,
            status: "down",
            lastCheck: Date.now(),
            responseTime: Date.now() - startTime,
            uptime: 0,
            error: error instanceof Error ? error.message : String(error),
          });

          result.alerts.push({
            level: "error",
            message: `${registryType} registry for chain ${chainId} not found: ${error}`,
            timestamp: Date.now(),
            service: `registry-${registryType.toLowerCase()}-chain-${chainId}`,
          });
        }
      }
    }

    result.metrics.registryCount = healthyRegistries;
  }

  /**
   * Calculate overall health status
   */
  private calculateOverallHealth(result: HealthCheckResult): void {
    const criticalServices = result.services.filter(
      (s) => s.status === "down"
    ).length;
    const degradedServices = result.services.filter(
      (s) => s.status === "degraded"
    ).length;
    const criticalAlerts = result.alerts.filter(
      (a) => a.level === "critical"
    ).length;

    if (criticalServices > 0 || criticalAlerts > 0) {
      result.overall = "unhealthy";
    } else if (degradedServices > 0) {
      result.overall = "degraded";
    } else {
      result.overall = "healthy";
    }

    // Calculate error rate
    result.metrics.errorRate = (this.errorCount / this.checkCount) * 100;
  }

  /**
   * Output health results in specified format
   */
  private outputHealthResults(result: HealthCheckResult): void {
    const timestamp = new Date(result.timestamp).toISOString();

    switch (this.config.outputFormat) {
      case "json":
        console.log(JSON.stringify(result, null, 2));
        break;

      case "prometheus":
        this.outputPrometheusMetrics(result);
        break;

      default: // console
        this.outputConsoleStatus(result, timestamp);
        break;
    }
  }

  /**
   * Output console-friendly status
   */
  private outputConsoleStatus(
    result: HealthCheckResult,
    timestamp: string
  ): void {
    const statusIcon =
      result.overall === "healthy"
        ? "✅"
        : result.overall === "degraded"
        ? "⚠️"
        : "❌";

    console.log(
      `\n[${timestamp}] ${statusIcon} Overall Status: ${result.overall.toUpperCase()}`
    );

    // Service status summary
    const serviceCount = result.services.length;
    const upServices = result.services.filter((s) => s.status === "up").length;
    const downServices = result.services.filter(
      (s) => s.status === "down"
    ).length;
    const degradedServices = result.services.filter(
      (s) => s.status === "degraded"
    ).length;

    console.log(
      `📊 Services: ${upServices}/${serviceCount} up, ${degradedServices} degraded, ${downServices} down`
    );
    console.log(`📈 Network Latency: ${result.metrics.networkLatency}ms`);
    console.log(
      `🔗 Gateways: ${result.metrics.gatewayCount}/${this.config.monitoredChains.length}`
    );
    console.log(`🛡️  Registries: ${result.metrics.registryCount}`);

    // Show alerts
    if (result.alerts.length > 0) {
      console.log(`\n🚨 Alerts (${result.alerts.length}):`);
      result.alerts.forEach((alert) => {
        const icon =
          alert.level === "critical"
            ? "🔴"
            : alert.level === "error"
            ? "🟠"
            : "🟡";
        console.log(`  ${icon} ${alert.level.toUpperCase()}: ${alert.message}`);
      });
    }
  }

  /**
   * Output Prometheus-compatible metrics
   */
  private outputPrometheusMetrics(result: HealthCheckResult): void {
    const metrics = [
      `# HELP via_labs_gateway_up Gateway service availability`,
      `# TYPE via_labs_gateway_up gauge`,
      `via_labs_gateway_up{status="${result.overall}"} ${
        result.overall === "healthy" ? 1 : 0
      }`,

      `# HELP via_labs_network_latency_ms Network response time in milliseconds`,
      `# TYPE via_labs_network_latency_ms gauge`,
      `via_labs_network_latency_ms ${result.metrics.networkLatency}`,

      `# HELP via_labs_services_up Number of services that are up`,
      `# TYPE via_labs_services_up gauge`,
      `via_labs_services_up ${
        result.services.filter((s) => s.status === "up").length
      }`,

      `# HELP via_labs_gateways_active Number of active gateways`,
      `# TYPE via_labs_gateways_active gauge`,
      `via_labs_gateways_active ${result.metrics.gatewayCount}`,

      `# HELP via_labs_alerts_total Number of active alerts`,
      `# TYPE via_labs_alerts_total counter`,
      `via_labs_alerts_total ${result.alerts.length}`,
    ];

    console.log(metrics.join("\n"));
  }

  /**
   * Get registry type discriminant
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
    console.log("🏥 Via Labs V4 Health Check Service");
    console.log("\nUsage:");
    console.log("  yarn health <network> [options]");
    console.log("\nNetworks:");
    console.log("  localnet   - Local development");
    console.log("  devnet     - Devnet testing");
    console.log("  testnet    - Testnet validation");
    console.log("  mainnet    - Production deployment");
    console.log("\nOptions:");
    console.log("  --program-id <id>           Override program ID");
    console.log("  --wallet <path>             Override wallet path");
    console.log(
      "  --interval <ms>             Check interval in milliseconds (default: 30000)"
    );
    console.log("  --continuous                Run continuous monitoring");
    console.log(
      "  --format <format>           Output format: console, json, prometheus"
    );
    console.log("  --chains <id1,id2>          Chains to monitor (default: 1)");
    console.log("\nExamples:");
    console.log("  yarn health localnet");
    console.log("  yarn health devnet --continuous --interval 60000");
    console.log("  yarn health mainnet --format prometheus");
    return;
  }

  const network = args[0];
  let programId: string | undefined;
  let walletPath: string | undefined;
  let interval = 30000;
  let continuous = false;
  let format: "console" | "json" | "prometheus" = "console";
  let chains = [1];

  // Parse options
  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--program-id":
        programId = args[++i];
        break;
      case "--wallet":
        walletPath = args[++i];
        break;
      case "--interval":
        interval = parseInt(args[++i]);
        break;
      case "--continuous":
        continuous = true;
        break;
      case "--format":
        format = args[++i] as "console" | "json" | "prometheus";
        break;
      case "--chains":
        chains = args[++i].split(",").map((c) => parseInt(c.trim()));
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

    const config: HealthConfig = {
      programId:
        programId || networkInfo.programId || process.env.PROGRAM_ID || "",
      networkUrl: networkInfo.url,
      walletPath:
        walletPath || process.env.ANCHOR_WALLET || "~/.config/solana/id.json",
      checkInterval: interval,
      thresholds: {
        responseTime: 5000, // 5 seconds
        errorRate: 5, // 5%
        uptime: 99, // 99%
      },
      monitoredChains: chains,
      enableContinuous: continuous,
      outputFormat: format,
    };

    if (!config.programId) {
      throw new Error(
        "Program ID not found. Specify --program-id or set PROGRAM_ID environment variable"
      );
    }

    const healthService = new HealthCheckService(config);
    await healthService.startMonitoring();
  } catch (error) {
    console.error(`❌ Health check failed: ${error}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { HealthCheckService, HealthConfig, HealthCheckResult };
