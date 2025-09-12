/**
 * Via Labs V4 Message Gateway Deployment Script
 *
 * This script deploys the message gateway program and performs initial setup.
 * Called automatically by 'anchor deploy' or 'anchor migrate'.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
// Types will be generated during build process
// import { MessageGatewayV4 } from "../target/types/message_gateway_v4";

export default async function (provider: anchor.AnchorProvider) {
  // Configure client to use the provider
  anchor.setProvider(provider);

  const program = anchor.workspace.MessageGatewayV4 as Program<any>;

  console.log("🚀 Deploying Via Labs V4 Message Gateway...");
  console.log("📍 Program ID:", program.programId.toString());
  console.log("🌐 Cluster:", provider.connection.rpcEndpoint);
  console.log("👛 Deployer:", provider.wallet.publicKey.toString());

  try {
    // Program is already deployed via 'anchor build && anchor deploy'
    // This script can perform any post-deployment setup if needed

    console.log("✅ Deployment successful!");
    console.log("🔗 Program deployed at:", program.programId.toString());

    // Optional: Initialize any required accounts or perform setup
    // Example: Initialize registries, set initial configuration, etc.
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    throw error;
  }
}
