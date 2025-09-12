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

describe("Integration Tests - Error Recovery & Edge Cases", () => {
  let context: TestContext;

  beforeEach(async () => {
    // Each test gets a unique chain ID to avoid PDA conflicts
    context = new TestContext();
    // Initialize gateway by default for error recovery tests
    // Use silent setup to avoid premature logging
    await context.setup({ silent: true });
  });

  afterEach(async () => {
    await context.teardown();
  });

  it("[ERROR-001] should recover from interrupted TX1 → TX2 flow", async () => {
    logTestHeader("[ERROR-001] Recovery from Interrupted TX1 → TX2 Flow");
    context.showContext();
    logSubtest("Testing recovery from interrupted flow");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 1000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData = Buffer.from("recovery-test-data", "utf8");
    const offChainData = Buffer.from("interrupted-flow", "utf8");

    // TX1: Create TxId PDA
    const tx1 = await context.createTxPda(txId, sourceChainId);
    const cuUsed1 = await logTransactionWithCU(
      tx1,
      context.connection,
      context,
      "Create TxId PDA (Pre-Interrupt)",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    context.metrics.transactionCount++;
    logSuccess("TX1 completed - TxId PDA created");

    // Simulate system interruption (disable system)
    await context.setSystemEnabled(false);
    logSuccess("System interrupted (disabled)");

    // TX2: Try to process message (should fail due to system disabled)
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
    logSuccess("TX2 correctly blocked during system interruption");

    // Verify TxId PDA still exists (flow is recoverable)
    const txIdExistsAfterInterruption = await context.txIdPDAExists(
      sourceChainId,
      txId
    );
    expect(txIdExistsAfterInterruption).to.be.true;
    logSuccess("TxId PDA preserved during interruption");

    // System recovery (re-enable system)
    await context.setSystemEnabled(true);
    logSuccess("System recovered (re-enabled)");

    // TX2: Complete the flow (should now succeed)
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
      "Process Message (Recovery)",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    context.metrics.transactionCount++;

    // Verify flow completed successfully
    const txIdExistsAfterRecovery = await context.txIdPDAExists(
      sourceChainId,
      txId
    );
    expect(txIdExistsAfterRecovery).to.be.false;

    logSuccess("Flow recovered successfully after system interruption");
    console.log(`  Recovery TX1: ${tx1}`);
    console.log(`  Recovery TX2: ${tx2}`);
    console.log(`  TX1 CU used: ${cuUsed1}`);
    console.log(`  TX2 CU used: ${cuUsed2}`);
  });

  it("[ERROR-002] should handle partial batch failures gracefully", async () => {
    logTestHeader("[ERROR-002] Partial Batch Failure Handling");
    context.showContext();
    logSubtest("Testing partial batch failure handling");

    const baseTime = Date.now();
    const sourceChainId = new BN(baseTime + 2000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");

    // Create a batch of messages
    const messages = [
      {
        txId: new BN(baseTime + 10),
        onChainData: Buffer.from("batch-message-1", "utf8"),
        offChainData: Buffer.from("batch-1", "utf8"),
      },
      {
        txId: new BN(baseTime + 20),
        onChainData: Buffer.from("batch-message-2", "utf8"),
        offChainData: Buffer.from("batch-2", "utf8"),
      },
      {
        txId: new BN(baseTime + 30),
        onChainData: Buffer.from("batch-message-3", "utf8"),
        offChainData: Buffer.from("batch-3", "utf8"),
      },
    ];

    // TX1: Create all TxId PDAs
    for (const message of messages) {
      const tx1 = await context.createTxPda(message.txId, sourceChainId);
      const cuUsed = await logTransactionWithCU(
        tx1,
        context.connection,
        context,
        `TX1-${message.txId.toString()}`,
        CU_LIMITS.EXPECTED_CREATE_TX_PDA
      );
      context.metrics.transactionCount++;
    }
    logSuccess("All TX1s completed - batch prepared");

    // TX2: Process first message (should succeed)
    await context.processMessage(
      messages[0].txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      messages[0].onChainData,
      messages[0].offChainData
    );
    logSuccess("Message 1 processed successfully");

    // Disable system before processing remaining messages
    await context.setSystemEnabled(false);
    logSuccess("System disabled - simulating partial batch failure");

    // TX2: Try to process remaining messages (should fail)
    for (let i = 1; i < messages.length; i++) {
      await expectRevert(
        context.processMessage(
          messages[i].txId,
          sourceChainId,
          destChainId,
          sender,
          recipient,
          messages[i].onChainData,
          messages[i].offChainData
        ),
        ERROR_CODES.SYSTEM_DISABLED
      );
    }
    logSuccess("Remaining messages correctly blocked");

    // Verify partial completion state
    const message1Exists = await context.txIdPDAExists(
      sourceChainId,
      messages[0].txId
    );
    const message2Exists = await context.txIdPDAExists(
      sourceChainId,
      messages[1].txId
    );
    const message3Exists = await context.txIdPDAExists(
      sourceChainId,
      messages[2].txId
    );

    expect(message1Exists).to.be.false; // Processed
    expect(message2Exists).to.be.true; // Pending
    expect(message3Exists).to.be.true; // Pending

    logSuccess("Partial batch state validated");
    console.log(`  Message 1: Processed ✅`);
    console.log(`  Message 2: Pending ⏳`);
    console.log(`  Message 3: Pending ⏳`);

    // Re-enable system and complete remaining messages
    await context.setSystemEnabled(true);
    logSuccess("System re-enabled");

    for (let i = 1; i < messages.length; i++) {
      const tx2 = await context.processMessage(
        messages[i].txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        messages[i].onChainData,
        messages[i].offChainData
      );
      const cuUsed = await logTransactionWithCU(
        tx2,
        context.connection,
        context,
        `Recovery-TX2-${i + 1}`,
        CU_LIMITS.EXPECTED_PROCESS_MESSAGE
      );
      context.metrics.transactionCount++;
    }

    // Verify all messages are now processed
    for (const message of messages) {
      const exists = await context.txIdPDAExists(sourceChainId, message.txId);
      expect(exists).to.be.false;
    }

    logSuccess("Partial batch failure recovery completed successfully");
  });

  it("[ERROR-003] should handle chain ID mismatches gracefully", async () => {
    logTestHeader("[ERROR-003] Chain ID Mismatch Handling");
    context.showContext();
    logSubtest("Testing chain ID mismatch handling");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 3000000);
    const wrongDestChainId = new BN(999999); // Wrong destination chain
    const correctDestChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData = Buffer.from("chain-id-test", "utf8");
    const offChainData = Buffer.from("mismatch-recovery", "utf8");

    // TX1: Create TxId PDA
    await context.createTxPda(txId, sourceChainId);
    logSuccess("TX1 completed");

    // TX2: Try with wrong destination chain ID (should fail)
    await expectRevert(
      context.processMessage(
        txId,
        sourceChainId,
        wrongDestChainId, // Wrong dest chain - program now validates this
        sender,
        recipient,
        onChainData,
        offChainData
      ),
      "InvalidDestChain" // Program-level validation now rejects invalid dest chains
    );

    logSuccess("TX2 with wrong dest chain correctly rejected");

    // Verify TxId PDA still exists (wasn't processed due to validation failure)
    const txIdExists = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExists).to.be.true;

    // TX2: Now try with correct destination chain ID (should succeed)
    const tx2 = await context.processMessage(
      txId,
      sourceChainId,
      correctDestChainId, // Correct dest chain
      sender,
      recipient,
      onChainData,
      offChainData
    );

    const cuUsed = await logTransactionWithCU(
      tx2,
      context.connection,
      context,
      "TX2-with-correct-dest-chain",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    context.metrics.transactionCount++;

    // Verify TxId PDA was closed after successful processing
    const txIdExistsAfter = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExistsAfter).to.be.false;

    logSuccess("Chain ID validation works correctly at program level");
    console.log(`  Source Chain: ${sourceChainId.toString()}`);
    console.log(
      `  Wrong Dest Chain: ${wrongDestChainId.toString()} - REJECTED ❌`
    );
    console.log(
      `  Correct Dest Chain: ${correctDestChainId.toString()} - ACCEPTED ✅`
    );
    console.log(
      `  Note: Dest chain validation is now enforced at program level`
    );
  });

  it("[ERROR-004] should handle multiple gateway interactions", async () => {
    logTestHeader("[ERROR-004] Multiple Gateway Interactions");
    context.showContext();
    logSubtest("Testing multiple gateway interactions");

    // Create second gateway context with different chain ID
    const context2 = new TestContext(new BN(Date.now() + 4000000));
    await context2.setup();

    const txId1 = new BN(Date.now() + 10);
    const txId2 = new BN(Date.now() + 20);
    const sourceChainId = CHAIN_IDS.ETHEREUM_MAINNET;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData1 = Buffer.from("gateway-1-data", "utf8");
    const onChainData2 = Buffer.from("gateway-2-data", "utf8");
    const offChainData = Buffer.from("multi-gateway", "utf8");

    try {
      // Process message on Gateway 1
      logSubtest("Processing message on Gateway 1");
      await context.createTxPda(txId1, sourceChainId);
      await context.processMessage(
        txId1,
        sourceChainId,
        context.chainId,
        sender,
        recipient,
        onChainData1,
        offChainData
      );
      logSuccess("Gateway 1 message processed");

      // Process message on Gateway 2
      logSubtest("Processing message on Gateway 2");
      await context2.createTxPda(txId2, sourceChainId);
      await context2.processMessage(
        txId2,
        sourceChainId,
        context2.chainId,
        sender,
        recipient,
        onChainData2,
        offChainData
      );
      logSuccess("Gateway 2 message processed");

      // Verify both messages were processed independently
      const tx1Exists = await context.txIdPDAExists(sourceChainId, txId1);
      const tx2Exists = await context2.txIdPDAExists(sourceChainId, txId2);

      expect(tx1Exists).to.be.false;
      expect(tx2Exists).to.be.false;

      // Test cross-gateway state independence
      await context.setSystemEnabled(false);
      const gateway1State = await context.getGateway();
      const gateway2State = await context2.getGateway();

      expect(gateway1State.systemEnabled).to.be.false;
      expect(gateway2State.systemEnabled).to.be.true; // Independent state

      logSuccess("Multiple gateway interactions handled correctly");
      console.log(`  Gateway 1 Chain: ${context.chainId.toString()}`);
      console.log(`  Gateway 2 Chain: ${context2.chainId.toString()}`);
      console.log(
        `  Gateway 1 Status: ${
          gateway1State.systemEnabled ? "ENABLED" : "DISABLED"
        }`
      );
      console.log(
        `  Gateway 2 Status: ${
          gateway2State.systemEnabled ? "ENABLED" : "DISABLED"
        }`
      );
    } finally {
      // Cleanup second context
      await context2.teardown();
    }
  });

  it("[ERROR-005] should handle edge case: empty data payloads", async () => {
    logTestHeader("[ERROR-005] Edge Case - Empty Data Payloads");
    context.showContext();
    logSubtest("Testing edge case with empty data payloads");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 5000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const emptyOnChainData = Buffer.alloc(0); // Empty buffer
    const emptyOffChainData = Buffer.alloc(0); // Empty buffer

    // TX1: Create TxId PDA
    const tx1 = await context.createTxPda(txId, sourceChainId);
    const cuUsed1 = await logTransactionWithCU(
      tx1,
      context.connection,
      context,
      "TX1 Empty Data",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    context.metrics.transactionCount++;

    // TX2: Process message with empty payloads
    const tx2 = await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      emptyOnChainData,
      emptyOffChainData
    );
    const cuUsed2 = await logTransactionWithCU(
      tx2,
      context.connection,
      context,
      "TX2 Empty Data",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    context.metrics.transactionCount++;

    // Verify message was processed successfully
    const txIdExists = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExists).to.be.false;

    logSuccess("Empty data payloads handled correctly");
    console.log(`  On-chain data size: ${emptyOnChainData.length} bytes`);
    console.log(`  Off-chain data size: ${emptyOffChainData.length} bytes`);
  });

  it("[ERROR-006] should handle edge case: maximum address sizes", async () => {
    logTestHeader("[ERROR-006] Edge Case - Maximum Address Sizes");
    context.showContext();
    logSubtest("Testing edge case with maximum address sizes");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 6000000);
    const destChainId = context.chainId;

    // Test with maximum size addresses (32 bytes each)
    const maxSender = Buffer.alloc(32, 0xff); // Max size sender
    const maxRecipient = Buffer.alloc(32, 0xaa); // Max size recipient
    const onChainData = Buffer.from("max-address-test", "utf8");
    const offChainData = Buffer.from("edge-case-testing", "utf8");

    // TX1: Create TxId PDA
    const tx1 = await context.createTxPda(txId, sourceChainId);
    const cuUsed1 = await logTransactionWithCU(
      tx1,
      context.connection,
      context,
      "TX1 Max Addresses",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    context.metrics.transactionCount++;

    // TX2: Process message with maximum size addresses
    const tx2 = await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      maxSender,
      maxRecipient,
      onChainData,
      offChainData
    );
    const cuUsed2 = await logTransactionWithCU(
      tx2,
      context.connection,
      context,
      "TX2 Max Addresses",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    context.metrics.transactionCount++;

    // Verify message was processed successfully
    const txIdExists = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExists).to.be.false;

    logSuccess("Maximum address sizes handled correctly");
    console.log(`  Sender size: ${maxSender.length} bytes`);
    console.log(`  Recipient size: ${maxRecipient.length} bytes`);
  });

  it("[ERROR-007] should handle rapid system state changes during processing", async () => {
    logTestHeader("[ERROR-007] Rapid System State Changes During Processing");
    context.showContext();
    logSubtest("Testing rapid system state changes");

    const baseTime = Date.now();
    const sourceChainId = new BN(baseTime + 7000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");

    // Create multiple messages
    const messages = [];
    for (let i = 0; i < 3; i++) {
      messages.push({
        txId: new BN(baseTime + i + 100),
        onChainData: Buffer.from(`rapid-state-${i}`, "utf8"),
        offChainData: Buffer.from(`state-change-${i}`, "utf8"),
      });
    }

    // TX1: Create all TxId PDAs
    for (const message of messages) {
      await context.createTxPda(message.txId, sourceChainId);
    }
    logSuccess("All TX1s completed");

    // Rapid state changes with interspersed processing
    let processedCount = 0;

    // Process first message
    await context.processMessage(
      messages[0].txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      messages[0].onChainData,
      messages[0].offChainData
    );
    processedCount++;
    logSuccess(`Message 1 processed (${processedCount}/3)`);

    // Rapid state change: disable → enable
    await context.setSystemEnabled(false);
    await context.setSystemEnabled(true);
    logSuccess("Rapid state change: DISABLED → ENABLED");

    // Process second message
    await context.processMessage(
      messages[1].txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      messages[1].onChainData,
      messages[1].offChainData
    );
    processedCount++;
    logSuccess(`Message 2 processed (${processedCount}/3)`);

    // Another rapid state change: enable → disable → enable
    await context.setSystemEnabled(false);
    await context.setSystemEnabled(true);
    logSuccess("Rapid state change: ENABLED → DISABLED → ENABLED");

    // Process third message
    await context.processMessage(
      messages[2].txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      messages[2].onChainData,
      messages[2].offChainData
    );
    processedCount++;
    logSuccess(`Message 3 processed (${processedCount}/3)`);

    // Verify all messages were processed
    for (const message of messages) {
      const exists = await context.txIdPDAExists(sourceChainId, message.txId);
      expect(exists).to.be.false;
    }

    expect(processedCount).to.equal(3);

    logSuccess("Rapid system state changes handled correctly");
    console.log(`  Total messages processed: ${processedCount}`);
    console.log(`  System state remained consistent throughout`);
  });
});
