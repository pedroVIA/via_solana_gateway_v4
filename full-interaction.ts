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

// Helper functions
function deriveGatewayPDA(programId: PublicKey, chainId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("gateway"), chainId.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

function deriveTxIdPDA(programId: PublicKey, sourceChainId: BN, txId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("tx"),
      sourceChainId.toArrayLike(Buffer, "le", 8),
      txId.toArrayLike(Buffer, "le", 16)
    ],
    programId
  );
}

function deriveCounterPDA(programId: PublicKey, sourceChainId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), sourceChainId.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

async function main() {
  console.log("🚀 Via Labs V4 Message Gateway - Full Demo");
  console.log("Program ID:", program.programId.toString());
  console.log("Wallet:", wallet.publicKey.toString());

  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Wallet balance:", balance / anchor.web3.LAMPORTS_PER_SOL, "SOL");

  const chainId = new BN(1); // Solana chain
  const [gatewayPDA] = deriveGatewayPDA(program.programId, chainId);
  
  console.log("\n📋 Gateway Info:");
  console.log("Chain ID:", chainId.toString());
  console.log("Gateway PDA:", gatewayPDA.toString());

  try {
    // 1. Check gateway state
    console.log("\n1️⃣ Checking gateway state...");
    const gateway = await program.account.messageGateway.fetch(gatewayPDA);
    console.log("✅ Gateway exists!");
    console.log("- Authority:", gateway.authority.toString());
    console.log("- Chain ID:", gateway.chainId.toString());
    console.log("- System Enabled:", gateway.systemEnabled);

    // 2. Send a message
    console.log("\n2️⃣ Sending cross-chain message...");
    const txId = new BN(Math.floor(Math.random() * 1000000));
    const recipient = Buffer.from("742d35Cc3C6C6B48F83F4c3F6c97d8C2B61Ab2B4", "hex"); // ETH address
    const destChainId = new BN(2); // Ethereum
    const chainData = Buffer.from("Hello from Solana!");
    const confirmations = 1;

    const sendTx = await program.methods
      .sendMessage(txId, recipient, destChainId, chainData, confirmations)
      .accounts({
        gateway: gatewayPDA,
        sender: wallet.publicKey,
      })
      .rpc();
    
    console.log("✅ Message sent!");
    console.log("- Transaction:", sendTx);
    console.log("- TX ID:", txId.toString());
    console.log("- Destination:", destChainId.toString(), "(Ethereum)");
    console.log("- Data:", chainData.toString());

    // 3. Demonstrate two-transaction replay protection
    console.log("\n3️⃣ Demonstrating two-transaction replay protection...");
    
    // TX1: Create TxId PDA
    const incomingTxId = new BN(Math.floor(Math.random() * 1000000));
    const sourceChainId = new BN(2); // From Ethereum
    const [txIdPDA] = deriveTxIdPDA(program.programId, sourceChainId, incomingTxId);
    const [counterPDA] = deriveCounterPDA(program.programId, sourceChainId);
    
    console.log("Creating TX PDA for replay protection...");
    const createTx = await program.methods
      .createTxPda(incomingTxId, sourceChainId)
      .accounts({
        txIdPda: txIdPDA,
        counterPda: counterPDA,
        relayer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ TX1 - TxId PDA created!");
    console.log("- Transaction:", createTx);
    console.log("- TxId PDA:", txIdPDA.toString());

    // Verify TxId PDA exists
    const txIdAccount = await program.account.txIdPda.fetch(txIdPDA);
    console.log("- TX ID:", txIdAccount.txId.toString());
    console.log("- Source Chain:", txIdAccount.sourceChainId.toString());
    console.log("- Created at slot:", txIdAccount.createdAt.toString());

    // TX2: Process message (this will close the TxId PDA)
    console.log("\nProcessing incoming message...");
    const sender = Buffer.from("0000000000000000000000000000000000000001", "hex");
    const recipientSolana = Buffer.from(wallet.publicKey.toBytes());
    const onChainData = Buffer.from("Processed message");
    const offChainData = Buffer.from("Additional data");

    const processTx = await program.methods
      .processMessage(
        incomingTxId,
        sourceChainId,
        chainId,
        sender,
        recipientSolana,
        onChainData,
        offChainData
      )
      .accounts({
        gateway: gatewayPDA,
        txIdPda: txIdPDA,
        relayer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ TX2 - Message processed!");
    console.log("- Transaction:", processTx);
    console.log("- TxId PDA closed (rent reclaimed)");

    // 4. Try to replay (should fail)
    console.log("\n4️⃣ Testing replay protection...");
    try {
      await program.methods
        .createTxPda(incomingTxId, sourceChainId)
        .accounts({
          txIdPda: txIdPDA,
          counterPda: counterPDA,
          relayer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      console.log("❌ Replay protection failed - this should not happen!");
    } catch (replayError) {
      console.log("✅ Replay protection working - duplicate TX rejected");
      console.log("- Error (expected):", (replayError as any).message.split('\n')[0]);
    }

    // 5. Check counter PDA
    console.log("\n5️⃣ Checking counter state...");
    try {
      const counter = await program.account.counterPda.fetch(counterPDA);
      console.log("✅ Counter PDA exists!");
      console.log("- Source Chain ID:", counter.sourceChainId.toString());
      console.log("- TX Count:", counter.txCount.toString());
    } catch (error) {
      console.log("❌ Counter PDA not found");
    }

    console.log("\n🎉 Demo completed successfully!");
    console.log("Via Labs V4 Message Gateway is working correctly on Solana Devnet");

  } catch (error) {
    console.error("Error during demo:", error);
  }
}

main().catch(console.error);