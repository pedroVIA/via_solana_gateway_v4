import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

import {
  TestContext,
  CHAIN_IDS,
  CU_LIMITS,
  ERROR_CODES,
  TEST_ADDRESSES,
  logTestHeader,
  logSubtest,
  logSuccess,
  logTransactionWithCU,
  expectRevert,
} from "../../setup";

describe("Integration Tests - Two-Transaction Flow", () => {
  let context: TestContext;

  beforeEach(async () => {
    // Each test gets a unique chain ID to avoid PDA conflicts
    context = new TestContext();
    // Initialize gateway by default for integration tests
    // Use silent setup to avoid premature logging
    await context.setup({ silent: true });
  });

  afterEach(async () => {
    await context.teardown();
  });

  it("[FLOW-001] should complete full TX1 → TX2 flow successfully", async () => {
    logTestHeader("[FLOW-001] Complete Two-Transaction Flow");
    context.showContext();
    logSubtest("Testing complete two-transaction message flow");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 1000000); // Unique source chain
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData = Buffer.from("integration-test-data", "utf8");
    const offChainData = Buffer.from("off-chain-integration", "utf8");

    // Get initial relayer balance
    const relayerBalanceInitial = await context.connection.getBalance(
      context.relayer!.publicKey
    );
    logSuccess(
      `Initial relayer balance: ${
        relayerBalanceInitial / anchor.web3.LAMPORTS_PER_SOL
      } SOL`
    );

    // TX1: Create TxId PDA for replay protection
    logSubtest("Step 1: Creating TxId PDA (TX1)");
    const tx1 = await context.createTxPda(txId, sourceChainId);
    const cuUsed1 = await logTransactionWithCU(
      tx1,
      context.connection,
      context,
      "Create TxId PDA",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    context.metrics.transactionCount++;

    // Verify TxId PDA was created
    const txIdExists = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExists).to.be.true;
    logSuccess("TxId PDA created successfully");

    // Get counter value after TX1
    const counterAfterTx1 = await context.getCounterPDA(sourceChainId);
    if (counterAfterTx1) {
      expect(counterAfterTx1.highestTxIdSeen.toNumber()).to.be.greaterThan(0);
      logSuccess(
        `Highest TX ID seen: ${counterAfterTx1.highestTxIdSeen.toString()}`
      );
    } else {
      logSuccess("Counter PDA created (initial state)");
    }

    // TX2: Process message and close TxId PDA
    logSubtest("Step 2: Processing message (TX2)");
    const tx2 = await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      onChainData,
      offChainData
    );
    const cuUsed2 = await logTransactionWithCU(
      tx2,
      context.connection,
      context,
      "Process Message",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    context.metrics.transactionCount++;

    // Verify TxId PDA was closed (should not exist anymore)
    const txIdExistsAfter = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExistsAfter).to.be.false;
    logSuccess("TxId PDA closed successfully");

    // Verify relayer balance change (rent reclaim minus transaction fees)
    const relayerBalanceFinal = await context.connection.getBalance(
      context.relayer!.publicKey
    );
    const balanceChange =
      (relayerBalanceFinal - relayerBalanceInitial) /
      anchor.web3.LAMPORTS_PER_SOL;

    // Balance might be negative due to tx fees, but should be close to zero (rent reclaimed)
    expect(Math.abs(balanceChange)).to.be.lessThan(0.01); // Within 0.01 SOL of original
    logSuccess(`Balance change (rent - fees): ${balanceChange.toFixed(6)} SOL`);

    // Performance checks
    expect(cuUsed1).to.be.lessThan(
      CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5,
      `TX1 used ${cuUsed1} CU, expected <${
        CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5
      }`
    );
    expect(cuUsed2).to.be.lessThan(
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE * 1.5,
      `TX2 used ${cuUsed2} CU, expected <${
        CU_LIMITS.EXPECTED_PROCESS_MESSAGE * 1.5
      }`
    );

    // Verify counter remains same (TX2 doesn't change highest_tx_id_seen)
    const counterAfterTx2 = await context.getCounterPDA(sourceChainId);
    if (counterAfterTx2 && counterAfterTx1) {
      expect(counterAfterTx2.highestTxIdSeen.toString()).to.equal(
        counterAfterTx1.highestTxIdSeen.toString()
      );
    }

    logSuccess("Complete two-transaction flow executed successfully");
    console.log(`  TX1 (Create): ${tx1}`);
    console.log(`  TX2 (Process): ${tx2}`);
    console.log(`  Balance Change: ${balanceChange.toFixed(6)} SOL`);
  });

  it("[FLOW-002] should prevent TX2 without TX1 (replay protection)", async () => {
    logTestHeader("[FLOW-002] TX2 without TX1 Prevention");
    context.showContext();
    logSubtest("Testing TX2 without TX1 prevention");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 2000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData = Buffer.from("test-data", "utf8");
    const offChainData = Buffer.from("off-chain-test", "utf8");

    // Try TX2 without TX1 (should fail)
    await expectRevert(
      context.processMessage(
        txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData
      ),
      "AccountNotInitialized" // TxId PDA doesn't exist
    );

    logSuccess("TX2 without TX1 correctly prevented");
  });

  it("[FLOW-003] should prevent duplicate TX2 (replay protection)", async () => {
    logTestHeader("[FLOW-003] Duplicate TX2 Prevention");
    context.showContext();
    logSubtest("Testing duplicate TX2 prevention");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 3000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData = Buffer.from("test-data", "utf8");
    const offChainData = Buffer.from("off-chain-test", "utf8");

    // TX1: Create TxId PDA
    await context.createTxPda(txId, sourceChainId);
    logSuccess("TX1: TxId PDA created");

    // TX2: First process (should succeed)
    await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      onChainData,
      offChainData
    );
    logSuccess("TX2: First process succeeded");

    // Try TX2 again (should fail - PDA was closed)
    await expectRevert(
      context.processMessage(
        txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData
      ),
      "AccountNotInitialized" // TxId PDA no longer exists
    );

    logSuccess("Duplicate TX2 correctly prevented");
  });

  it("[FLOW-004] should handle multiple concurrent TX1s for different messages", async () => {
    logTestHeader("[FLOW-004] Multiple Concurrent TX1 Operations");
    context.showContext();
    logSubtest("Testing multiple concurrent TX1 operations");

    const baseTime = Date.now();
    const sourceChainId = new BN(baseTime + 4000000);

    // Create multiple TxId PDAs concurrently
    const txIds = [
      new BN(baseTime + 1),
      new BN(baseTime + 2),
      new BN(baseTime + 3),
    ];

    // TX1: Create all TxId PDAs
    const tx1Promises = txIds.map((txId) =>
      context.createTxPda(txId, sourceChainId)
    );

    const tx1Results = await Promise.all(tx1Promises);
    for (let index = 0; index < tx1Results.length; index++) {
      const cuUsed = await logTransactionWithCU(
        tx1Results[index],
        context.connection,
        context,
        `TX1-${index + 1}`,
        CU_LIMITS.EXPECTED_CREATE_TX_PDA
      );
      context.metrics.transactionCount++;
    }

    // Verify all TxId PDAs exist
    for (const txId of txIds) {
      const exists = await context.txIdPDAExists(sourceChainId, txId);
      expect(exists).to.be.true;
    }

    // Verify counter was updated correctly
    const counter = await context.getCounterPDA(sourceChainId);
    if (counter) {
      expect(counter.highestTxIdSeen.toNumber()).to.be.greaterThan(0);
      console.log(
        `  Highest TX ID seen: ${counter.highestTxIdSeen.toString()}`
      );
    }

    logSuccess("Multiple concurrent TX1s handled correctly");
    console.log(`  Created PDAs: ${txIds.length}`);
  });

  it("[FLOW-005] should complete multiple full flows for different messages", async () => {
    logTestHeader("[FLOW-005] Multiple Complete Message Flows");
    context.showContext();
    logSubtest("Testing multiple complete message flows");

    const baseTime = Date.now();
    const sourceChainId = new BN(baseTime + 5000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");

    const messages = [
      {
        txId: new BN(baseTime + 10),
        onChainData: Buffer.from("message-1", "utf8"),
        offChainData: Buffer.from("off-chain-1", "utf8"),
      },
      {
        txId: new BN(baseTime + 20),
        onChainData: Buffer.from("message-2", "utf8"),
        offChainData: Buffer.from("off-chain-2", "utf8"),
      },
      {
        txId: new BN(baseTime + 30),
        onChainData: Buffer.from("message-3", "utf8"),
        offChainData: Buffer.from("off-chain-3", "utf8"),
      },
    ];

    // Process all messages: TX1 → TX2 for each
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      logSubtest(`Processing message ${i + 1}/3`);

      // TX1: Create TxId PDA
      const tx1 = await context.createTxPda(message.txId, sourceChainId);
      const cuUsed1 = await logTransactionWithCU(
        tx1,
        context.connection,
        context,
        `TX1-${i + 1}`,
        CU_LIMITS.EXPECTED_CREATE_TX_PDA
      );
      context.metrics.transactionCount++;

      // TX2: Process message
      const tx2 = await context.processMessage(
        message.txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        message.onChainData,
        message.offChainData
      );
      const cuUsed2 = await logTransactionWithCU(
        tx2,
        context.connection,
        context,
        `TX2-${i + 1}`,
        CU_LIMITS.EXPECTED_PROCESS_MESSAGE
      );
      context.metrics.transactionCount++;

      // Verify TxId PDA was closed
      const txIdExists = await context.txIdPDAExists(
        sourceChainId,
        message.txId
      );
      expect(txIdExists).to.be.false;

      logSuccess(`Message ${i + 1} processed successfully`);
    }

    // Verify final counter value
    const finalCounter = await context.getCounterPDA(sourceChainId);
    if (finalCounter) {
      expect(finalCounter.highestTxIdSeen.toNumber()).to.be.greaterThan(0);
      console.log(
        `  Final highest TX ID: ${finalCounter.highestTxIdSeen.toString()}`
      );
    }

    logSuccess("Multiple complete flows executed successfully");
    console.log(`  Messages processed: ${messages.length}`);
  });

  it("[FLOW-006] should enforce system disabled state across TX1 → TX2 flow", async () => {
    logTestHeader("[FLOW-006] System Disabled State Enforcement");
    context.showContext();
    logSubtest("Testing system disabled enforcement in flow");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 6000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData = Buffer.from("test-data", "utf8");
    const offChainData = Buffer.from("off-chain-test", "utf8");

    // TX1: Create TxId PDA while system is enabled
    await context.createTxPda(txId, sourceChainId);
    logSuccess("TX1: TxId PDA created while system enabled");

    // Disable system
    await context.setSystemEnabled(false);
    logSuccess("System disabled");

    // TX2: Try to process message (should fail)
    await expectRevert(
      context.processMessage(
        txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData
      ),
      ERROR_CODES.SYSTEM_DISABLED
    );

    // Verify TxId PDA still exists (wasn't processed)
    const txIdExists = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExists).to.be.true;

    // Re-enable system and complete flow
    await context.setSystemEnabled(true);
    logSuccess("System re-enabled");

    // TX2: Now should succeed
    await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      onChainData,
      offChainData
    );

    // Verify TxId PDA was closed
    const txIdExistsAfter = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExistsAfter).to.be.false;

    logSuccess("System state enforcement works correctly in TX1 → TX2 flow");
  });

  it("[FLOW-007] should handle cross-chain message routing validation", async () => {
    logTestHeader("[FLOW-007] Cross-Chain Message Routing Validation");
    context.showContext();
    logSubtest("Testing cross-chain message routing validation");

    const txId = new BN(Date.now());
    const sourceChainId = CHAIN_IDS.ETHEREUM_MAINNET; // Different from dest
    const destChainId = context.chainId; // Solana testnet
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData = Buffer.from("cross-chain-data", "utf8");
    const offChainData = Buffer.from("ethereum-to-solana", "utf8");

    // TX1: Create TxId PDA
    const tx1 = await context.createTxPda(txId, sourceChainId);
    const cuUsed1 = await logTransactionWithCU(
      tx1,
      context.connection,
      context,
      "Cross-Chain TX1",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    context.metrics.transactionCount++;
    logSuccess(`TX1: Message from chain ${sourceChainId} prepared`);

    // TX2: Process cross-chain message
    const tx2 = await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      onChainData,
      offChainData
    );
    const cuUsed2 = await logTransactionWithCU(
      tx2,
      context.connection,
      context,
      "Cross-Chain TX2",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    context.metrics.transactionCount++;

    // Verify message was processed
    const txIdExists = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExists).to.be.false;

    logSuccess("Cross-chain message routing validated successfully");
    console.log(`  Source Chain: ${sourceChainId.toString()} (Ethereum)`);
    console.log(`  Dest Chain: ${destChainId.toString()} (Solana)`);
    console.log(`  Message processed: ${Buffer.from(onChainData).toString()}`);
  });

  it("[FLOW-008] should validate message parameters across TX1 → TX2 flow", async () => {
    logTestHeader("[FLOW-008] Message Parameter Validation");
    context.showContext();
    logSubtest("Testing message parameter validation in flow");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 7000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData = Buffer.from("parameter-validation-test", "utf8");
    const offChainData = Buffer.from("comprehensive-validation", "utf8");

    // TX1: Create TxId PDA
    await context.createTxPda(txId, sourceChainId);

    // TX2: Try with wrong txId (should fail)
    const wrongTxId = new BN(Date.now() + 999);
    await expectRevert(
      context.processMessage(
        wrongTxId, // Wrong txId
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData
      ),
      "AccountNotInitialized" // TxId PDA with wrong txId doesn't exist
    );

    logSuccess("Wrong txId correctly rejected");

    // TX2: Try with wrong sourceChainId (should fail)
    const wrongSourceChainId = new BN(Date.now() + 8888888);
    await expectRevert(
      context.processMessage(
        txId,
        wrongSourceChainId, // Wrong source chain
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData
      ),
      "AccountNotInitialized" // TxId PDA with wrong source chain doesn't exist
    );

    logSuccess("Wrong source chain ID correctly rejected");

    // TX2: Now with correct parameters (should succeed)
    await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      onChainData,
      offChainData
    );

    logSuccess("Message parameter validation works correctly");
  });
});
