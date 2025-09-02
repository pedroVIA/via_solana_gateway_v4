import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { MessageGatewayV4 } from "./target/types/message_gateway_v4";
import { BN } from "@coral-xyz/anchor";

// Set up connection to devnet
const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
const wallet = anchor.Wallet.local();
const provider = new AnchorProvider(connection, wallet, {});
anchor.setProvider(provider);

// Get program
const program = anchor.workspace.MessageGatewayV4 as Program<MessageGatewayV4>;

// Helper to derive gateway PDA
function deriveGatewayPDA(programId: PublicKey, chainId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("gateway"), chainId.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

async function main() {
  console.log("🚀 Interacting with Via Labs V4 Message Gateway");
  console.log("Program ID:", program.programId.toString());
  console.log("Wallet:", wallet.publicKey.toString());

  // Check wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Wallet balance:", balance / anchor.web3.LAMPORTS_PER_SOL, "SOL");

  // Test chain ID
  const chainId = new BN(1); // Solana testnet
  const [gatewayPDA, bump] = deriveGatewayPDA(program.programId, chainId);
  
  console.log("\n📋 Gateway Info:");
  console.log("Chain ID:", chainId.toString());
  console.log("Gateway PDA:", gatewayPDA.toString());
  console.log("Bump:", bump);

  try {
    // Try to fetch existing gateway
    console.log("\n🔍 Checking if gateway exists...");
    const gateway = await program.account.messageGateway.fetch(gatewayPDA);
    console.log("✅ Gateway already exists!");
    console.log("- Authority:", gateway.authority.toString());
    console.log("- Chain ID:", gateway.chainId.toString());
    console.log("- System Enabled:", gateway.systemEnabled);
    console.log("- Bump:", gateway.bump);
  } catch (error) {
    // Gateway doesn't exist, let's initialize it
    console.log("❌ Gateway not found, initializing...");
    
    try {
      const tx = await program.methods
        .initializeGateway(chainId)
        .accounts({
          gateway: gatewayPDA,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      console.log("✅ Gateway initialized!");
      console.log("Transaction:", tx);
      
      // Fetch the newly created gateway
      const gateway = await program.account.messageGateway.fetch(gatewayPDA);
      console.log("- Authority:", gateway.authority.toString());
      console.log("- Chain ID:", gateway.chainId.toString());
      console.log("- System Enabled:", gateway.systemEnabled);
      console.log("- Bump:", gateway.bump);
      
    } catch (initError) {
      console.error("Failed to initialize gateway:", initError);
    }
  }
}

main().catch(console.error);