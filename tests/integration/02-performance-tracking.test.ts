import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

import { 
  TestContext,
  CU_LIMITS,
  TEST_ADDRESSES,
  logTestHeader,
  logSubtest,
  logSuccess,
  logTransactionWithCU
} from "../setup";

describe("Integration Tests - Performance & Compute Units", () => {
  let context: TestContext;

  beforeEach(async () => {
    // Each test gets a unique chain ID to avoid PDA conflicts
    context = new TestContext();
    // Initialize gateway by default for performance tests
    // Use silent setup to avoid premature logging
    await context.setup({ silent: true });
  });

  afterEach(async () => {
    await context.teardown();
  });

  it("[PERF-001] should track compute units for complete TX1 → TX2 flow", async () => {
    logTestHeader("[PERF-001] Compute Unit Tracking for Full Flow");
    context.showContext();
    logSubtest("Testing compute unit tracking for full flow");
    
    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 1000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex');
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex');
    const onChainData = Buffer.from("compute-unit-test", 'utf8');
    const offChainData = Buffer.from("performance-tracking", 'utf8');
    
    // Track initial transaction count (after setup and gateway initialization)
    const initialTxCount = context.metrics.transactionCount;
    
    // TX1: Create TxId PDA
    const tx1StartTime = Date.now();
    const tx1 = await context.createTxPda(txId, sourceChainId);
    const tx1Duration = Date.now() - tx1StartTime;
    
    const cuUsed1 = await logTransactionWithCU(
      tx1, 
      context.connection, 
      context, 
      "Create TxId PDA",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    logSuccess(`TX1 execution time: ${tx1Duration}ms`);
    
    // TX2: Process message
    const tx2StartTime = Date.now();
    const tx2 = await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      onChainData,
      offChainData
    );
    const tx2Duration = Date.now() - tx2StartTime;
    
    const cuUsed2 = await logTransactionWithCU(
      tx2, 
      context.connection, 
      context, 
      "Process Message",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    logSuccess(`TX2 execution time: ${tx2Duration}ms`);
    
    // Calculate total metrics
    const totalTxCount = context.metrics.transactionCount - initialTxCount;
    const totalDuration = tx1Duration + tx2Duration;
    
    // Validate performance expectations
    expect(totalTxCount).to.equal(2); // TX1 + TX2
    expect(tx1Duration).to.be.lessThan(5000); // Should complete in < 5s
    expect(tx2Duration).to.be.lessThan(5000); // Should complete in < 5s
    expect(cuUsed1).to.be.lessThan(CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5);
    expect(cuUsed2).to.be.lessThan(CU_LIMITS.EXPECTED_PROCESS_MESSAGE * 1.5);
    
    logSuccess("Compute unit tracking completed");
    console.log(`  Total transactions: ${totalTxCount}`);
    console.log(`  Total execution time: ${totalDuration}ms`);
    console.log(`  Average per transaction: ${Math.round(totalDuration / totalTxCount)}ms`);
    console.log(`  TX1 CU used: ${cuUsed1}`);
    console.log(`  TX2 CU used: ${cuUsed2}`);
    console.log(`  Total CU used: ${cuUsed1 + cuUsed2}`);
  });

  it("[PERF-002] should handle high-throughput message processing", async () => {
    logTestHeader("[PERF-002] High-Throughput Message Processing");
    context.showContext();
    logSubtest("Testing high-throughput message processing");
    
    const messageCount = 5; // Process 5 messages rapidly
    const baseTime = Date.now();
    const sourceChainId = new BN(baseTime + 2000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex');
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex');
    
    const messages = [];
    for (let i = 0; i < messageCount; i++) {
      messages.push({
        txId: new BN(baseTime + i + 100),
        onChainData: Buffer.from(`high-throughput-${i}`, 'utf8'),
        offChainData: Buffer.from(`batch-${i}`, 'utf8')
      });
    }
    
    // Track performance
    const startTime = Date.now();
    const initialTxCount = context.metrics.transactionCount;
    
    // Process all messages sequentially (TX1 → TX2 for each)
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      
      // TX1: Create TxId PDA
      await context.createTxPda(message.txId, sourceChainId);
      
      // TX2: Process message
      await context.processMessage(
        message.txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        message.onChainData,
        message.offChainData
      );
      
      // Verify message was processed
      const exists = await context.txIdPDAExists(sourceChainId, message.txId);
      expect(exists).to.be.false;
    }
    
    const totalDuration = Date.now() - startTime;
    const totalTxCount = context.metrics.transactionCount - initialTxCount;
    
    // Performance validation
    expect(totalTxCount).to.equal(messageCount * 2); // 2 transactions per message
    const avgTimePerMessage = totalDuration / messageCount;
    const avgTimePerTx = totalDuration / totalTxCount;
    
    logSuccess("High-throughput processing completed");
    console.log(`  Messages processed: ${messageCount}`);
    console.log(`  Total transactions: ${totalTxCount}`);
    console.log(`  Total time: ${totalDuration}ms`);
    console.log(`  Average per message: ${Math.round(avgTimePerMessage)}ms`);
    console.log(`  Average per transaction: ${Math.round(avgTimePerTx)}ms`);
    console.log(`  Throughput: ${((messageCount / totalDuration) * 1000).toFixed(2)} messages/sec`);
  });

  it("[PERF-003] should measure rent economics for PDA lifecycle", async () => {
    logTestHeader("[PERF-003] Rent Economics for PDA Lifecycle");
    context.showContext();
    logSubtest("Testing rent economics and PDA lifecycle costs");
    
    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 3000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex');
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex');
    const onChainData = Buffer.from("rent-economics-test", 'utf8');
    const offChainData = Buffer.from("cost-analysis", 'utf8');
    
    // Track relayer balance throughout the flow
    const balanceInitial = await context.connection.getBalance(context.relayer!.publicKey);
    
    // TX1: Create TxId PDA (costs rent)
    const tx1 = await context.createTxPda(txId, sourceChainId);
    const balanceAfterTx1 = await context.connection.getBalance(context.relayer!.publicKey);
    const tx1Cost = (balanceInitial - balanceAfterTx1) / anchor.web3.LAMPORTS_PER_SOL;
    
    const cuUsed1 = await logTransactionWithCU(
      tx1, 
      context.connection, 
      context, 
      "Create TxId PDA (Rent)",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    context.metrics.transactionCount++;
    logSuccess(`TX1 cost (including rent): ${tx1Cost.toFixed(6)} SOL`);
    
    // TX2: Process message (reclaims rent)
    const tx2 = await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      onChainData,
      offChainData
    );
    const balanceFinal = await context.connection.getBalance(context.relayer!.publicKey);
    const tx2Benefit = (balanceFinal - balanceAfterTx1) / anchor.web3.LAMPORTS_PER_SOL;
    
    const cuUsed2 = await logTransactionWithCU(
      tx2, 
      context.connection, 
      context, 
      "Process Message (Reclaim)",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    context.metrics.transactionCount++;
    logSuccess(`TX2 net benefit (rent reclaim): ${tx2Benefit.toFixed(6)} SOL`);
    
    // Calculate net economics
    const netCost = (balanceInitial - balanceFinal) / anchor.web3.LAMPORTS_PER_SOL;
    const rentReclaimed = tx2Benefit;
    
    // Validate rent economics
    expect(tx1Cost).to.be.greaterThan(0); // TX1 should cost rent
    expect(tx2Benefit).to.be.greaterThan(0); // TX2 should return rent
    expect(rentReclaimed).to.be.approximately(0.001, 0.0005); // ~0.001 SOL rent for TxIdPDA
    
    logSuccess("Rent economics analysis completed");
    console.log(`  TX1 cost: ${tx1Cost.toFixed(6)} SOL`);
    console.log(`  TX2 benefit: ${tx2Benefit.toFixed(6)} SOL`);
    console.log(`  Net cost: ${netCost.toFixed(6)} SOL`);
    console.log(`  Rent reclaimed: ${rentReclaimed.toFixed(6)} SOL`);
    console.log(`  Transaction fees: ${(netCost).toFixed(6)} SOL`);
  });

  it("[PERF-004] should validate transaction size limits with large payloads", async () => {
    logTestHeader("[PERF-004] Transaction Size Limits with Large Payloads");
    context.showContext();
    logSubtest("Testing transaction size limits");
    
    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 4000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex');
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex');
    
    // Test different payload sizes
    const payloadSizes = [32, 64, 128, 256];
    
    for (const size of payloadSizes) {
      const testTxId = new BN(txId.toNumber() + size);
      const onChainData = Buffer.alloc(size, 0x41); // Fill with 'A'
      const offChainData = Buffer.from(`payload-size-${size}`, 'utf8');
      
      logSubtest(`Testing payload size: ${size} bytes`);
      
      // TX1: Create TxId PDA
      const tx1 = await context.createTxPda(testTxId, sourceChainId);
      
      // TX2: Process message with sized payload
      const tx2 = await context.processMessage(
        testTxId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        onChainData,
        offChainData
      );
      
      // Verify successful processing
      const exists = await context.txIdPDAExists(sourceChainId, testTxId);
      expect(exists).to.be.false;
      
      logSuccess(`Payload size ${size} bytes processed successfully`);
    }
    
    // Test maximum safe payload size (stay well under 1232 byte limit)
    const maxSafeSize = 512;
    const largeTxId = new BN(txId.toNumber() + 1000);
    const largeOnChainData = Buffer.alloc(maxSafeSize, 0x42); // Fill with 'B'
    const largeOffChainData = Buffer.from("maximum-payload-test", 'utf8');
    
    logSubtest(`Testing maximum safe payload: ${maxSafeSize} bytes`);
    
    await context.createTxPda(largeTxId, sourceChainId);
    await context.processMessage(
      largeTxId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      largeOnChainData,
      largeOffChainData
    );
    
    const largeExists = await context.txIdPDAExists(sourceChainId, largeTxId);
    expect(largeExists).to.be.false;
    
    logSuccess("Transaction size limit validation completed");
    console.log(`  Tested payload sizes: ${payloadSizes.join(', ')} bytes`);
    console.log(`  Maximum safe payload: ${maxSafeSize} bytes`);
  });

  it("[PERF-005] should measure concurrent transaction performance", async () => {
    logTestHeader("[PERF-005] Concurrent Transaction Performance");
    context.showContext();
    logSubtest("Testing concurrent transaction performance");
    
    const concurrentCount = 3; // Process 3 messages concurrently
    const baseTime = Date.now();
    const sourceChainId = new BN(baseTime + 5000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex');
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex');
    
    // Create concurrent messages
    const messages = [];
    for (let i = 0; i < concurrentCount; i++) {
      messages.push({
        txId: new BN(baseTime + i + 200),
        onChainData: Buffer.from(`concurrent-${i}`, 'utf8'),
        offChainData: Buffer.from(`parallel-${i}`, 'utf8')
      });
    }
    
    // Step 1: Create all TxId PDAs concurrently
    logSubtest("Step 1: Creating TxId PDAs concurrently");
    const tx1StartTime = Date.now();
    
    const tx1Promises = messages.map(message => 
      context.createTxPda(message.txId, sourceChainId)
    );
    
    const tx1Results = await Promise.all(tx1Promises);
    const tx1Duration = Date.now() - tx1StartTime;
    
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
    logSuccess(`All TX1s completed in: ${tx1Duration}ms`);
    
    // Step 2: Process all messages concurrently
    logSubtest("Step 2: Processing messages concurrently");
    const tx2StartTime = Date.now();
    
    const tx2Promises = messages.map(message => 
      context.processMessage(
        message.txId,
        sourceChainId,
        destChainId,
        sender,
        recipient,
        message.onChainData,
        message.offChainData
      )
    );
    
    const tx2Results = await Promise.all(tx2Promises);
    const tx2Duration = Date.now() - tx2StartTime;
    
    for (let index = 0; index < tx2Results.length; index++) {
      const cuUsed = await logTransactionWithCU(
        tx2Results[index], 
        context.connection, 
        context, 
        `TX2-${index + 1}`,
        CU_LIMITS.EXPECTED_PROCESS_MESSAGE
      );
      context.metrics.transactionCount++;
    }
    logSuccess(`All TX2s completed in: ${tx2Duration}ms`);
    
    // Verify all messages were processed
    for (const message of messages) {
      const exists = await context.txIdPDAExists(sourceChainId, message.txId);
      expect(exists).to.be.false;
    }
    
    // Calculate performance metrics
    const totalDuration = tx1Duration + tx2Duration;
    const avgConcurrentTime = totalDuration / 2; // 2 phases
    const totalTxCount = concurrentCount * 2;
    
    logSuccess("Concurrent transaction performance measured");
    console.log(`  Concurrent messages: ${concurrentCount}`);
    console.log(`  TX1 phase duration: ${tx1Duration}ms`);
    console.log(`  TX2 phase duration: ${tx2Duration}ms`);
    console.log(`  Total duration: ${totalDuration}ms`);
    console.log(`  Average phase time: ${Math.round(avgConcurrentTime)}ms`);
    console.log(`  Concurrent throughput: ${((totalTxCount / totalDuration) * 1000).toFixed(2)} tx/sec`);
  });

  it("[PERF-006] should validate system performance under load", async () => {
    logTestHeader("[PERF-006] System Performance Under Load");
    context.showContext();
    logSubtest("Testing system performance under load");
    
    const loadTestCount = 10; // Process 10 messages for load testing
    const baseTime = Date.now();
    const sourceChainId = new BN(baseTime + 6000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex');
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex');
    
    // Track system metrics
    const startTime = Date.now();
    const initialTxCount = context.metrics.transactionCount;
    const initialBalance = await context.connection.getBalance(context.relayer!.publicKey);
    
    // Create load test messages
    const messages = [];
    for (let i = 0; i < loadTestCount; i++) {
      messages.push({
        txId: new BN(baseTime + i + 300),
        onChainData: Buffer.from(`load-test-${i}`, 'utf8'),
        offChainData: Buffer.from(`stress-test-${i}`, 'utf8')
      });
    }
    
    // Process all messages in batches to simulate realistic load
    const batchSize = 3;
    const batches = [];
    for (let i = 0; i < messages.length; i += batchSize) {
      batches.push(messages.slice(i, i + batchSize));
    }
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      logSubtest(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} messages)`);
      
      // Process batch: All TX1s first, then all TX2s
      for (const message of batch) {
        await context.createTxPda(message.txId, sourceChainId);
      }
      
      for (const message of batch) {
        await context.processMessage(
          message.txId,
          sourceChainId,
          destChainId,
          sender,
          recipient,
          message.onChainData,
          message.offChainData
        );
      }
      
      logSuccess(`Batch ${batchIndex + 1} completed`);
    }
    
    // Calculate final metrics
    const totalDuration = Date.now() - startTime;
    const totalTxCount = context.metrics.transactionCount - initialTxCount;
    const finalBalance = await context.connection.getBalance(context.relayer!.publicKey);
    const netCost = (initialBalance - finalBalance) / anchor.web3.LAMPORTS_PER_SOL;
    
    // Validate load test performance
    expect(totalTxCount).to.equal(loadTestCount * 2);
    expect(totalDuration).to.be.lessThan(60000); // Should complete in < 60s
    
    // Verify all messages were processed
    for (const message of messages) {
      const exists = await context.txIdPDAExists(sourceChainId, message.txId);
      expect(exists).to.be.false;
    }
    
    logSuccess("Load testing completed successfully");
    console.log(`  Total messages: ${loadTestCount}`);
    console.log(`  Total transactions: ${totalTxCount}`);
    console.log(`  Total duration: ${totalDuration}ms`);
    console.log(`  Average per message: ${Math.round(totalDuration / loadTestCount)}ms`);
    console.log(`  Throughput: ${((loadTestCount / totalDuration) * 1000).toFixed(2)} messages/sec`);
    console.log(`  Net cost: ${netCost.toFixed(6)} SOL`);
    console.log(`  Cost per message: ${(netCost / loadTestCount).toFixed(8)} SOL`);
  });
});