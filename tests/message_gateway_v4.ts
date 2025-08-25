import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { MessageGatewayV4 } from "../target/types/message_gateway_v4";
import { expect } from "chai";

describe("Via Labs V4 Message Gateway MVP", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.MessageGatewayV4 as Program<MessageGatewayV4>;
  const provider = anchor.getProvider();

  // Test accounts
  let authority: Keypair;
  let relayer: Keypair;
  let gatewayPDA: PublicKey;
  let chainId: anchor.BN;

  before(async () => {
    // Initialize test accounts
    authority = Keypair.generate();
    relayer = Keypair.generate();
    
    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(authority.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(relayer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    
    // Wait for airdrop confirmation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create chain ID for Solana testnet (using u64)
    chainId = new anchor.BN(1); // Solana testnet chain ID
    
    // Derive gateway PDA
    [gatewayPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("gateway"), Buffer.from(chainId.toArray("le", 8))],
      program.programId
    );
    
    console.log("Test setup complete:");
    console.log("- Authority:", authority.publicKey.toString());
    console.log("- Relayer:", relayer.publicKey.toString());
    console.log("- Gateway PDA:", gatewayPDA.toString());
    console.log("- Chain ID:", chainId);
  });

  it("Should initialize the gateway", async () => {
    console.log("\n=== Testing Gateway Initialization ===");
    
    const tx = await program.methods
      .initializeGateway(chainId)
      .accounts({
        gateway: gatewayPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
      
    console.log("Gateway initialization tx:", tx);
    
    // Verify gateway account was created correctly
    const gatewayAccount = await program.account.messageGateway.fetch(gatewayPDA);
    expect(gatewayAccount.authority.toString()).to.equal(authority.publicKey.toString());
    expect(gatewayAccount.chainId.toString()).to.equal(chainId.toString());
    expect(gatewayAccount.systemEnabled).to.be.true;
    
    console.log("✅ Gateway initialized successfully");
    console.log("- Authority:", gatewayAccount.authority.toString());
    console.log("- Chain ID:", gatewayAccount.chainId.toString());
    console.log("- System Enabled:", gatewayAccount.systemEnabled);
  });

  it("Should send a cross-chain message", async () => {
    console.log("\n=== Testing Message Sending ===");
    
    // Test with Buffer parameters
    const recipient = Buffer.from("742d35Cc3C6C6B48F83F4c3F6c97d8C2B61Ab2B4", 'hex'); // Keep as Buffer
    const destChainId = new anchor.BN(2); // Ethereum mainnet chain ID  
    const chainData = Buffer.from("test", 'utf8'); // Keep as Buffer
    const confirmations = 1;
    
    // Generate a unique tx_id for this message
    const txId = new anchor.BN(Date.now());
    
    console.log("Parameters:");
    console.log("- recipient length:", recipient.length);
    console.log("- chainData length:", chainData.length);
    console.log("- destChainId:", destChainId.toString());
    
    const tx = await program.methods
      .sendMessage(
        txId,
        recipient,
        destChainId,
        chainData,
        confirmations
      )
      .accounts({
        gateway: gatewayPDA,
        sender: authority.publicKey,
      })
      .signers([authority])
      .rpc();
      
    console.log("Send message tx:", tx);
    
    // Verify message was sent (gateway account should still exist)
    const gatewayAccount = await program.account.messageGateway.fetch(gatewayPDA);
    expect(gatewayAccount.systemEnabled).to.be.true;
    
    console.log("✅ Message sent successfully");
    console.log("- TX ID:", txId.toString());
    console.log("- Recipient length:", recipient.length);
    console.log("- Destination Chain ID:", destChainId.toString());
    console.log("- Data length:", chainData.length);
  });

  it("Should process cross-chain message with two-transaction replay protection", async () => {
    console.log("\n=== Testing Two-Transaction Message Processing ===");
    
    // Simulate processing a message from Ethereum to Solana
    const txId = 12345;
    const sourceChainId = new anchor.BN(2); // Ethereum mainnet chain ID
    const destChainId = chainId; // Our Solana chain
    const sender = Buffer.from("742d35Cc3C6C6B48F83F4c3F6c97d8C2B61Ab2B4", 'hex');
    const recipient = Buffer.from(relayer.publicKey.toBytes());
    const onChainData = Buffer.from("mint(100, USDC)");
    const offChainData = Buffer.from("");
    
    // Derive PDAs for this message (let Anchor handle the serialization automatically)
    const [txIdPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("tx"),
        sourceChainId.toBuffer("le", 8),
        new anchor.BN(txId).toBuffer("le", 16)
      ],
      program.programId
    );
    
    const [counterPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("counter"), sourceChainId.toBuffer("le", 8)],
      program.programId
    );
    
    console.log("- TX ID PDA:", txIdPDA.toString());
    console.log("- Counter PDA:", counterPDA.toString());
    
    // TX1: Create TxId PDA for replay protection
    console.log("\n--- TX1: Creating TxId PDA for replay protection ---");
    const createTx = await program.methods
      .createTxPda(new anchor.BN(txId), sourceChainId)
      .accounts({
        txIdPda: txIdPDA,
        counterPda: counterPDA,
        relayer: relayer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([relayer])
      .rpc();
      
    console.log("Create TxId PDA tx:", createTx);
    
    // Verify TxId PDA was created
    const txIdAccount = await program.account.txIdPda.fetch(txIdPDA);
    expect(txIdAccount.txId.toString()).to.equal(txId.toString());
    expect(txIdAccount.bump).to.be.a('number');
    
    // Verify Counter PDA was created/updated
    const counterAccount = await program.account.counterPda.fetch(counterPDA);
    expect(counterAccount.highestTxIdSeen.toString()).to.equal(txId.toString());
    expect(counterAccount.sourceChainId.toString()).to.equal(sourceChainId.toString());
    
    console.log("✅ TX1 completed - TxId PDA created");
    console.log("- TX ID:", txIdAccount.txId.toString());
    console.log("- Source Chain ID:", counterAccount.sourceChainId.toString());
    console.log("- Highest TX ID seen:", counterAccount.highestTxIdSeen.toString());
    
    // TX2: Process message with atomic PDA closure
    console.log("\n--- TX2: Processing message with atomic PDA closure ---");
    const processTx = await program.methods
      .processMessage(
        new anchor.BN(txId),
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData
      )
      .accounts({
        gateway: gatewayPDA,
        txIdPda: txIdPDA,
        relayer: relayer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([relayer])
      .rpc();
      
    console.log("Process message tx:", processTx);
    
    // Verify TxId PDA was closed (should not exist anymore)
    try {
      await program.account.txIdPda.fetch(txIdPDA);
      throw new Error("TxId PDA should have been closed!");
    } catch (error) {
      if (error.message.includes("Account does not exist")) {
        console.log("✅ TX2 completed - TxId PDA closed atomically");
      } else {
        throw error;
      }
    }
    
    console.log("✅ Two-transaction replay protection working correctly");
    console.log("- Message processed successfully");
    console.log("- Rent reclaimed from closed PDA");
    console.log("- Replay protection active (can't reprocess same TX ID)");
  });

  it("Should prevent replay attacks", async () => {
    console.log("\n=== Testing Replay Attack Prevention ===");
    
    const txId = 99999;
    const sourceChainId = new anchor.BN(3); // Polygon mainnet chain ID - different chain to avoid collision
    
    // Try to create the same TxId PDA twice (should fail on second attempt)
    const [txIdPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("tx"),
        sourceChainId.toBuffer("le", 8),
        new anchor.BN(txId).toBuffer("le", 16)
      ],
      program.programId
    );
    
    const [counterPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("counter"), sourceChainId.toBuffer("le", 8)],
      program.programId
    );
    
    // First creation should succeed
    const createTx1 = await program.methods
      .createTxPda(new anchor.BN(txId), sourceChainId)
      .accounts({
        txIdPda: txIdPDA,
        counterPda: counterPDA,
        relayer: relayer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([relayer])
      .rpc();
      
    console.log("First TxId PDA creation succeeded:", createTx1);
    
    // Second creation should fail (replay attack prevented)
    try {
      await program.methods
        .createTxPda(new anchor.BN(txId), sourceChainId)
        .accounts({
          txIdPda: txIdPDA,
          counterPda: counterPDA,
          relayer: relayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([relayer])
        .rpc();
        
      throw new Error("Second TxId PDA creation should have failed!");
    } catch (error) {
      if (error.message.includes("already in use")) {
        console.log("✅ Replay attack prevented - duplicate TxId PDA creation blocked");
      } else {
        throw error;
      }
    }
    
    console.log("✅ Replay protection working correctly");
  });

  it("Should disable and enable system", async () => {
    console.log("\n=== Testing System Enable/Disable ===");
    
    // Disable system
    const disableTx = await program.methods
      .setSystemEnabled(false)
      .accounts({
        gateway: gatewayPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();
      
    console.log("System disable tx:", disableTx);
    
    // Verify system is disabled
    let gatewayAccount = await program.account.messageGateway.fetch(gatewayPDA);
    expect(gatewayAccount.systemEnabled).to.be.false;
    console.log("✅ System disabled");
    
    // Try to send message while disabled (should fail)
    try {
      const testRecipient = Buffer.alloc(20, 0); // 20-byte address
      const testDestChain = new anchor.BN(4); // Test chain ID
      const testData = Buffer.from("test", 'utf8');
      const testTxId = new anchor.BN(Date.now() + 1000); // Unique tx_id
      
      await program.methods
        .sendMessage(
          testTxId,
          testRecipient,
          testDestChain,
          testData,
          1
        )
        .accounts({
          gateway: gatewayPDA,
          sender: authority.publicKey,
        })
        .signers([authority])
        .rpc();
        
      throw new Error("Send message should have failed when system disabled!");
    } catch (error) {
      if (error.message.includes("SystemDisabled")) {
        console.log("✅ Message sending blocked when system disabled");
      } else {
        throw error;
      }
    }
    
    // Re-enable system
    const enableTx = await program.methods
      .setSystemEnabled(true)
      .accounts({
        gateway: gatewayPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();
      
    console.log("System enable tx:", enableTx);
    
    // Verify system is enabled
    gatewayAccount = await program.account.messageGateway.fetch(gatewayPDA);
    expect(gatewayAccount.systemEnabled).to.be.true;
    console.log("✅ System re-enabled");
  });
});