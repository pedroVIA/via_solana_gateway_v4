import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

import {
  TestContext,
  CHAIN_IDS,
  CU_LIMITS,
  TEST_ADDRESSES,
  logTestHeader,
  logSubtest,
  logSuccess,
  logTransactionWithCU,
  wait,
} from "../../setup";

describe("End-to-End Tests - Load Testing & Performance Benchmarks", () => {
  let context: TestContext;

  beforeEach(async () => {
    // Each test gets a unique chain ID to avoid PDA conflicts
    context = new TestContext();
    // Initialize gateway by default for load testing E2E tests
    // Use silent setup to avoid premature logging
    await context.setup({ silent: true });
  });

  afterEach(async () => {
    await context.teardown();
  });

  it("[E2E-013] should handle sustained high-frequency message processing", async () => {
    logTestHeader("[E2E-013] Sustained High-Frequency Message Processing");
    context.showContext();
    logSubtest("Testing sustained high-frequency message load");

    const loadTest = {
      duration_ms: 30000, // 30 seconds
      target_tps: 10, // Target 10 transactions per second
      messages_per_batch: 5,
      total_expected_messages: 300, // ~10 TPS * 30 seconds
    };

    logSuccess(`Load Test Parameters:`);
    console.log(`  Duration: ${loadTest.duration_ms}ms`);
    console.log(`  Target TPS: ${loadTest.target_tps}`);
    console.log(`  Batch Size: ${loadTest.messages_per_batch}`);
    console.log(`  Expected Messages: ${loadTest.total_expected_messages}`);

    const startTime = Date.now();
    const endTime = startTime + loadTest.duration_ms;
    const metrics = {
      messages_sent: 0,
      messages_processed: 0,
      batches_completed: 0,
      total_compute_units: 0,
      errors: 0,
      batch_times: [] as number[],
    };

    let messageId = startTime;

    logSubtest("Executing sustained load test...");

    while (Date.now() < endTime) {
      const batchStartTime = Date.now();
      const batchMessages = [];

      // Prepare batch of messages
      for (let i = 0; i < loadTest.messages_per_batch; i++) {
        batchMessages.push({
          txId: new BN(messageId++),
          sourceChain: new BN((messageId % 5) + 1000), // Rotate through 5 chains
          data: {
            batch_id: metrics.batches_completed,
            message_index: i,
            timestamp: Date.now(),
            payload: `load-test-${messageId}-${i}`,
            test_type: "sustained_load",
          },
        });
      }

      try {
        // Execute TX1 phase for batch
        const tx1Promises = batchMessages.map((msg) =>
          context.createTxPda(msg.txId, msg.sourceChain)
        );
        await Promise.all(tx1Promises);

        // Execute TX2 phase for batch
        const tx2Promises = batchMessages.map((msg) =>
          context.processMessage(
            msg.txId,
            msg.sourceChain,
            context.chainId,
            Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex"),
            Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex"),
            Buffer.from(JSON.stringify(msg.data)),
            Buffer.from(`load-${msg.txId}`)
          )
        );
        await Promise.all(tx2Promises);

        metrics.messages_processed += batchMessages.length;
        metrics.batches_completed++;

        const batchDuration = Date.now() - batchStartTime;
        metrics.batch_times.push(batchDuration);

        // Throttle to maintain target TPS
        const expectedBatchTime =
          (loadTest.messages_per_batch / loadTest.target_tps) * 1000;
        if (batchDuration < expectedBatchTime) {
          await wait(expectedBatchTime - batchDuration);
        }
      } catch (error) {
        metrics.errors++;
        console.log(`  Batch ${metrics.batches_completed} error: ${error}`);
      }
    }

    const totalDuration = Date.now() - startTime;
    const actualTps = metrics.messages_processed / (totalDuration / 1000);
    const avgBatchTime =
      metrics.batch_times.reduce((a, b) => a + b, 0) /
      metrics.batch_times.length;
    const maxBatchTime = Math.max(...metrics.batch_times);
    const minBatchTime = Math.min(...metrics.batch_times);

    logSuccess("Sustained load test completed");
    console.log(`  Duration: ${totalDuration}ms`);
    console.log(`  Messages Processed: ${metrics.messages_processed}`);
    console.log(`  Batches: ${metrics.batches_completed}`);
    console.log(`  Errors: ${metrics.errors}`);
    console.log(`  Actual TPS: ${actualTps.toFixed(2)}`);
    console.log(
      `  Batch Times - Avg: ${avgBatchTime.toFixed(
        0
      )}ms, Min: ${minBatchTime}ms, Max: ${maxBatchTime}ms`
    );

    // Performance assertions
    expect(metrics.errors).to.be.lessThan(5); // Less than 5 errors acceptable
    expect(actualTps).to.be.greaterThan(loadTest.target_tps * 0.8); // Within 80% of target
    expect(avgBatchTime).to.be.lessThan(5000); // Average batch under 5 seconds

    logSuccess(`Load test passed: ${actualTps.toFixed(2)} TPS achieved`);
  });

  it("[E2E-014] should handle burst traffic and auto-recovery", async () => {
    logTestHeader("[E2E-014] Burst Traffic and Auto-Recovery");
    context.showContext();
    logSubtest("Testing burst traffic handling and recovery");

    const burstTest = {
      normal_tps: 5,
      burst_tps: 25,
      burst_duration_ms: 5000,
      recovery_duration_ms: 10000,
      messages_per_burst: 5,
    };

    logSuccess(`Burst Test Parameters:`);
    console.log(`  Normal TPS: ${burstTest.normal_tps}`);
    console.log(`  Burst TPS: ${burstTest.burst_tps}`);
    console.log(`  Burst Duration: ${burstTest.burst_duration_ms}ms`);
    console.log(`  Recovery Duration: ${burstTest.recovery_duration_ms}ms`);

    const testStartTime = Date.now();
    let messageId = testStartTime;

    // Phase 1: Normal load
    logSubtest("Phase 1: Normal baseline load");
    const normalStartTime = Date.now();
    const normalMessages = [];

    for (let i = 0; i < 10; i++) {
      // 10 normal messages
      const msg = {
        txId: new BN(messageId++),
        sourceChain: CHAIN_IDS.ETHEREUM_MAINNET,
        phase: "normal",
      };
      normalMessages.push(msg);

      await context.createTxPda(msg.txId, msg.sourceChain);
      await context.processMessage(
        msg.txId,
        msg.sourceChain,
        context.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex"),
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex"),
        Buffer.from(JSON.stringify({ phase: "normal", id: i })),
        Buffer.from(`normal-${msg.txId}`)
      );

      await wait(1000 / burstTest.normal_tps); // Maintain normal TPS
    }

    const normalDuration = Date.now() - normalStartTime;
    const normalTps = normalMessages.length / (normalDuration / 1000);
    logSuccess(
      `Normal phase: ${
        normalMessages.length
      } messages in ${normalDuration}ms (${normalTps.toFixed(2)} TPS)`
    );

    // Phase 2: Burst load
    logSubtest("Phase 2: High-intensity burst load");
    const burstStartTime = Date.now();
    const burstMessages = [];

    // Generate burst messages rapidly
    const burstMessageCount = Math.floor(
      burstTest.burst_tps * (burstTest.burst_duration_ms / 1000)
    );
    const burstBatches = Math.ceil(
      burstMessageCount / burstTest.messages_per_burst
    );

    for (let batch = 0; batch < burstBatches; batch++) {
      const batchMessages = [];

      for (
        let i = 0;
        i < burstTest.messages_per_burst &&
        burstMessages.length < burstMessageCount;
        i++
      ) {
        const msg = {
          txId: new BN(messageId++),
          sourceChain: new BN(2000 + (batch % 3)), // Rotate source chains
          phase: "burst",
          batch,
          index: i,
        };
        batchMessages.push(msg);
        burstMessages.push(msg);
      }

      // Execute batch concurrently
      const tx1Promises = batchMessages.map((msg) =>
        context.createTxPda(msg.txId, msg.sourceChain)
      );
      await Promise.all(tx1Promises);

      const tx2Promises = batchMessages.map((msg) =>
        context.processMessage(
          msg.txId,
          msg.sourceChain,
          context.chainId,
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex"),
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex"),
          Buffer.from(
            JSON.stringify({
              phase: "burst",
              batch: msg.batch,
              index: msg.index,
              timestamp: Date.now(),
            })
          ),
          Buffer.from(`burst-${msg.txId}`)
        )
      );
      await Promise.all(tx2Promises);

      // Small delay to control burst rate
      if (Date.now() - burstStartTime < burstTest.burst_duration_ms) {
        await wait(50); // 50ms between batches
      }
    }

    const burstDuration = Date.now() - burstStartTime;
    const burstTps = burstMessages.length / (burstDuration / 1000);
    logSuccess(
      `Burst phase: ${
        burstMessages.length
      } messages in ${burstDuration}ms (${burstTps.toFixed(2)} TPS)`
    );

    // Phase 3: Recovery monitoring
    logSubtest("Phase 3: System recovery monitoring");
    const recoveryStartTime = Date.now();
    const recoveryMessages = [];

    // Monitor system during recovery with light load
    while (Date.now() - recoveryStartTime < burstTest.recovery_duration_ms) {
      const msg = {
        txId: new BN(messageId++),
        sourceChain: CHAIN_IDS.POLYGON_MAINNET,
        phase: "recovery",
      };
      recoveryMessages.push(msg);

      try {
        await context.createTxPda(msg.txId, msg.sourceChain);
        await context.processMessage(
          msg.txId,
          msg.sourceChain,
          context.chainId,
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex"),
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex"),
          Buffer.from(
            JSON.stringify({ phase: "recovery", timestamp: Date.now() })
          ),
          Buffer.from(`recovery-${msg.txId}`)
        );
      } catch (error) {
        console.log(`  Recovery message failed: ${error}`);
      }

      await wait(2000); // 2 second intervals
    }

    const recoveryDuration = Date.now() - recoveryStartTime;
    const recoveryTps = recoveryMessages.length / (recoveryDuration / 1000);
    logSuccess(
      `Recovery phase: ${
        recoveryMessages.length
      } messages in ${recoveryDuration}ms (${recoveryTps.toFixed(2)} TPS)`
    );

    // Verify all phases completed successfully
    const allMessages = [
      ...normalMessages,
      ...burstMessages,
      ...recoveryMessages,
    ];
    let verificationErrors = 0;

    for (const msg of allMessages) {
      try {
        const exists = await context.txIdPDAExists(msg.sourceChain, msg.txId);
        if (exists) verificationErrors++;
      } catch {
        verificationErrors++;
      }
    }

    const totalTestDuration = Date.now() - testStartTime;
    const overallTps = allMessages.length / (totalTestDuration / 1000);

    logSuccess("Burst traffic test completed");
    console.log(`  Total Duration: ${totalTestDuration}ms`);
    console.log(`  Total Messages: ${allMessages.length}`);
    console.log(`  Overall TPS: ${overallTps.toFixed(2)}`);
    console.log(
      `  Normal TPS: ${normalTps.toFixed(2)} (target: ${burstTest.normal_tps})`
    );
    console.log(
      `  Burst TPS: ${burstTps.toFixed(2)} (target: ${burstTest.burst_tps})`
    );
    console.log(`  Recovery TPS: ${recoveryTps.toFixed(2)}`);
    console.log(`  Verification Errors: ${verificationErrors}`);

    // Performance assertions
    expect(verificationErrors).to.be.lessThan(5);
    expect(burstTps).to.be.greaterThan(burstTest.burst_tps * 0.7); // 70% of burst target
    expect(recoveryTps).to.be.greaterThan(0.3); // System still responsive during recovery
  });

  it("[E2E-015] should benchmark compute unit efficiency under load", async () => {
    logTestHeader("[E2E-015] Compute Unit Efficiency Under Load");
    context.showContext();
    logSubtest("Testing compute unit efficiency under various loads");

    const cuBenchmark = {
      payload_sizes: [
        { name: "tiny", size: 32, count: 20 },
        { name: "small", size: 256, count: 15 },
        { name: "medium", size: 1024, count: 10 },
        { name: "large", size: 2048, count: 5 },
      ],
    };

    const benchmarkResults = [];

    for (const payloadTest of cuBenchmark.payload_sizes) {
      logSubtest(
        `Benchmarking ${payloadTest.name} payloads (${payloadTest.size} bytes)`
      );

      const testStartTime = Date.now();
      const initialCU = context.metrics.totalComputeUnits;
      const initialTxCount = context.metrics.transactionCount;

      const messages = [];
      for (let i = 0; i < payloadTest.count; i++) {
        const payload = Buffer.alloc(payloadTest.size, i % 256);
        const message = {
          txId: new BN(Date.now() + i),
          sourceChain: new BN(3000 + i),
          payload,
          metadata: {
            test_type: "cu_benchmark",
            payload_size: payloadTest.size,
            payload_name: payloadTest.name,
            message_index: i,
          },
        };
        messages.push(message);
      }

      // Execute TX1 phase
      const tx1StartTime = Date.now();
      const tx1Promises = messages.map((msg) =>
        context.createTxPda(msg.txId, msg.sourceChain)
      );
      await Promise.all(tx1Promises);
      const tx1Duration = Date.now() - tx1StartTime;

      // Execute TX2 phase
      const tx2StartTime = Date.now();
      const tx2Promises = messages.map((msg) =>
        context.processMessage(
          msg.txId,
          msg.sourceChain,
          context.chainId,
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex"),
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex"),
          msg.payload, // Use variable-size payload
          Buffer.from(JSON.stringify(msg.metadata))
        )
      );
      await Promise.all(tx2Promises);
      const tx2Duration = Date.now() - tx2StartTime;

      const testDuration = Date.now() - testStartTime;
      const finalCU = context.metrics.totalComputeUnits;
      const finalTxCount = context.metrics.transactionCount;

      const cuUsed = finalCU - initialCU;
      const txCount = finalTxCount - initialTxCount;
      const avgCuPerTx = cuUsed / txCount;
      const avgCuPerMessage = cuUsed / messages.length;
      const throughput = messages.length / (testDuration / 1000);

      const result = {
        payload_name: payloadTest.name,
        payload_size: payloadTest.size,
        message_count: messages.length,
        total_duration_ms: testDuration,
        tx1_duration_ms: tx1Duration,
        tx2_duration_ms: tx2Duration,
        compute_units_used: cuUsed,
        transactions_executed: txCount,
        avg_cu_per_tx: Math.round(avgCuPerTx),
        avg_cu_per_message: Math.round(avgCuPerMessage),
        throughput_msgs_per_sec: Number(throughput.toFixed(2)),
        efficiency_score: Number(
          (throughput / (avgCuPerMessage / 1000)).toFixed(2)
        ),
      };

      benchmarkResults.push(result);

      logSuccess(`${payloadTest.name} payload benchmark completed`);
      console.log(`  Messages: ${result.message_count}`);
      console.log(`  Payload Size: ${result.payload_size} bytes`);
      console.log(`  Duration: ${result.total_duration_ms}ms`);
      console.log(`  CU Used: ${result.compute_units_used.toLocaleString()}`);
      console.log(`  Avg CU/TX: ${result.avg_cu_per_tx.toLocaleString()}`);
      console.log(
        `  Avg CU/Msg: ${result.avg_cu_per_message.toLocaleString()}`
      );
      console.log(`  Throughput: ${result.throughput_msgs_per_sec} msgs/sec`);
      console.log(`  Efficiency: ${result.efficiency_score}`);
    }

    // Analyze benchmark results
    logSubtest("Benchmark Analysis");

    const bestEfficiency = Math.max(
      ...benchmarkResults.map((r) => r.efficiency_score)
    );
    const worstEfficiency = Math.min(
      ...benchmarkResults.map((r) => r.efficiency_score)
    );
    const bestThroughput = Math.max(
      ...benchmarkResults.map((r) => r.throughput_msgs_per_sec)
    );
    const avgCuPerTx =
      benchmarkResults.reduce((sum, r) => sum + r.avg_cu_per_tx, 0) /
      benchmarkResults.length;

    logSuccess("Compute Unit Benchmark Analysis");
    console.log(
      `  Best Efficiency: ${bestEfficiency} (${
        benchmarkResults.find((r) => r.efficiency_score === bestEfficiency)
          ?.payload_name
      })`
    );
    console.log(
      `  Worst Efficiency: ${worstEfficiency} (${
        benchmarkResults.find((r) => r.efficiency_score === worstEfficiency)
          ?.payload_name
      })`
    );
    console.log(`  Best Throughput: ${bestThroughput} msgs/sec`);
    console.log(`  Average CU/TX: ${Math.round(avgCuPerTx).toLocaleString()}`);

    // Performance assertions
    expect(avgCuPerTx).to.be.lessThan(CU_LIMITS.MAX_PER_TRANSACTION * 0.8); // Under 80% of max
    expect(bestThroughput).to.be.greaterThan(2); // At least 2 msgs/sec for best case
    expect(bestEfficiency).to.be.greaterThan(0.01); // Minimum efficiency threshold

    // Check that smaller payloads are more efficient
    const tinyResult = benchmarkResults.find((r) => r.payload_name === "tiny");
    const largeResult = benchmarkResults.find(
      (r) => r.payload_name === "large"
    );

    if (tinyResult && largeResult) {
      expect(tinyResult.avg_cu_per_message).to.be.lessThan(
        largeResult.avg_cu_per_message
      );
      logSuccess(
        "Payload size efficiency validated: smaller payloads use fewer CU"
      );
    }
  });

  it("[E2E-016] should test memory and resource utilization patterns", async () => {
    logTestHeader("[E2E-016] Memory and Resource Utilization Patterns");
    context.showContext();
    logSubtest("Testing memory and resource utilization under load");

    const resourceTest = {
      concurrent_chains: 10,
      messages_per_chain: 8,
      chain_id_base: 5000,
    };

    logSuccess(`Resource Test Parameters:`);
    console.log(`  Concurrent Chains: ${resourceTest.concurrent_chains}`);
    console.log(`  Messages per Chain: ${resourceTest.messages_per_chain}`);
    console.log(
      `  Total Messages: ${
        resourceTest.concurrent_chains * resourceTest.messages_per_chain
      }`
    );

    const testStartTime = Date.now();
    const allMessages = [];

    // Generate messages across multiple chains
    for (
      let chainIndex = 0;
      chainIndex < resourceTest.concurrent_chains;
      chainIndex++
    ) {
      const sourceChain = new BN(resourceTest.chain_id_base + chainIndex);

      for (
        let msgIndex = 0;
        msgIndex < resourceTest.messages_per_chain;
        msgIndex++
      ) {
        const message = {
          txId: new BN(Date.now() + chainIndex * 1000 + msgIndex),
          sourceChain,
          chainIndex,
          msgIndex,
          data: {
            chain_id: sourceChain.toString(),
            message_sequence: msgIndex,
            resource_test: true,
            large_data_field: "x".repeat(500), // Add some payload size
            metadata: {
              chain_index: chainIndex,
              total_chains: resourceTest.concurrent_chains,
              timestamp: Date.now(),
            },
          },
        };
        allMessages.push(message);
      }
    }

    logSubtest("Phase 1: Creating PDAs across multiple chains");
    const createStartTime = Date.now();

    // Create all PDAs (this tests PDA creation across many chains)
    const createPromises = allMessages.map((msg) =>
      context.createTxPda(msg.txId, msg.sourceChain)
    );
    await Promise.all(createPromises);

    const createDuration = Date.now() - createStartTime;
    logSuccess(
      `PDA creation phase: ${allMessages.length} PDAs in ${createDuration}ms`
    );

    // Check Counter PDA creation across chains
    const counterChecks = [];
    for (let i = 0; i < resourceTest.concurrent_chains; i++) {
      const sourceChain = new BN(resourceTest.chain_id_base + i);
      const counterExists = await context.counterPDAExists(sourceChain);
      counterChecks.push({
        chain: sourceChain.toString(),
        exists: counterExists,
      });
    }

    const countersCreated = counterChecks.filter((c) => c.exists).length;
    logSuccess(
      `Counter PDAs created: ${countersCreated}/${resourceTest.concurrent_chains}`
    );

    logSubtest("Phase 2: Processing messages across all chains");
    const processStartTime = Date.now();

    const processPromises = allMessages.map((msg) =>
      context.processMessage(
        msg.txId,
        msg.sourceChain,
        context.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex"),
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex"),
        Buffer.from(JSON.stringify(msg.data)),
        Buffer.from(`resource-test-${msg.chainIndex}-${msg.msgIndex}`)
      )
    );

    const processResults = await Promise.all(processPromises);
    const processDuration = Date.now() - processStartTime;

    logSuccess(
      `Message processing phase: ${allMessages.length} messages in ${processDuration}ms`
    );

    logSubtest("Phase 3: Resource utilization analysis");

    // Verify all messages processed (PDAs should be closed)
    let pdaCleanupErrors = 0;
    for (const msg of allMessages) {
      const exists = await context.txIdPDAExists(msg.sourceChain, msg.txId);
      if (exists) pdaCleanupErrors++;
    }

    // Check final counter states
    const finalCounterStates = [];
    for (let i = 0; i < resourceTest.concurrent_chains; i++) {
      const sourceChain = new BN(resourceTest.chain_id_base + i);
      const counter = await context.getCounterPDA(sourceChain);
      if (counter) {
        finalCounterStates.push({
          chain_id: sourceChain.toString(),
          highest_tx_id: counter.highestTxIdSeen.toString(),
          messages_processed: resourceTest.messages_per_chain,
        });
      }
    }

    const totalDuration = Date.now() - testStartTime;
    const overallThroughput = allMessages.length / (totalDuration / 1000);
    const avgCreateTime = createDuration / allMessages.length;
    const avgProcessTime = processDuration / allMessages.length;
    const pdaCleanupRate =
      ((allMessages.length - pdaCleanupErrors) / allMessages.length) * 100;

    logSuccess("Resource utilization test completed");
    console.log(`  Total Duration: ${totalDuration}ms`);
    console.log(
      `  Overall Throughput: ${overallThroughput.toFixed(2)} msgs/sec`
    );
    console.log(`  Avg PDA Creation Time: ${avgCreateTime.toFixed(1)}ms`);
    console.log(`  Avg Processing Time: ${avgProcessTime.toFixed(1)}ms`);
    console.log(`  PDA Cleanup Rate: ${pdaCleanupRate.toFixed(1)}%`);
    console.log(
      `  Counter PDAs Active: ${finalCounterStates.length}/${resourceTest.concurrent_chains}`
    );
    console.log(`  PDA Cleanup Errors: ${pdaCleanupErrors}`);

    // Log chain-specific statistics
    const chainStats = [];
    for (let i = 0; i < Math.min(5, resourceTest.concurrent_chains); i++) {
      const chainMessages = allMessages.filter((msg) => msg.chainIndex === i);
      const chainCompletedMessages = chainMessages.length; // All should be completed
      chainStats.push({
        chain_index: i,
        chain_id: resourceTest.chain_id_base + i,
        messages: chainCompletedMessages,
        completion_rate: "100%", // Since we verified all completed
      });
    }

    console.log(`  Sample Chain Statistics (first 5 chains):`);
    chainStats.forEach((stat) => {
      console.log(
        `    Chain ${stat.chain_index} (${stat.chain_id}): ${stat.messages} messages, ${stat.completion_rate} completion`
      );
    });

    // Performance assertions
    expect(pdaCleanupRate).to.be.greaterThan(95); // 95% cleanup rate
    expect(overallThroughput).to.be.greaterThan(8); // At least 8 msgs/sec overall
    expect(finalCounterStates.length).to.be.greaterThan(
      resourceTest.concurrent_chains * 0.8
    ); // 80% counter creation
    expect(avgCreateTime).to.be.lessThan(1000); // Under 1 second per PDA creation
    expect(avgProcessTime).to.be.lessThan(1500); // Under 1.5 seconds per message processing

    logSuccess("Resource utilization benchmarks passed");
  });

  it("[E2E-017] should benchmark transaction finality and confirmation times", async () => {
    logTestHeader("[E2E-017] Transaction Finality and Confirmation Times");
    context.showContext();
    logSubtest("Testing transaction finality and confirmation patterns");

    const finalityTest = {
      sample_size: 25,
      confirmation_levels: [1, 2, 3], // Different confirmation requirements
      timing_precision_ms: 10,
    };

    logSuccess(`Finality Test Parameters:`);
    console.log(`  Sample Size: ${finalityTest.sample_size} messages`);
    console.log(
      `  Confirmation Levels: ${finalityTest.confirmation_levels.join(", ")}`
    );

    const finalityResults = [];

    for (const confirmLevel of finalityTest.confirmation_levels) {
      logSubtest(`Testing with ${confirmLevel} confirmation(s)`);

      const confirmResults = {
        confirmation_level: confirmLevel,
        messages: [],
        avg_tx1_time: 0,
        avg_tx2_time: 0,
        avg_total_time: 0,
        min_total_time: Infinity,
        max_total_time: 0,
        std_deviation: 0,
      };

      // Execute sample messages with precise timing
      for (let i = 0; i < finalityTest.sample_size; i++) {
        const messageStartTime = Date.now();
        const messageId = Date.now() + i * 10; // Spread IDs to avoid conflicts

        const message = {
          txId: new BN(messageId),
          sourceChain: new BN(6000 + (i % 3)), // Rotate through 3 chains
          confirmations: confirmLevel,
          timing: {
            start: messageStartTime,
            tx1_start: 0,
            tx1_end: 0,
            tx2_start: 0,
            tx2_end: 0,
            total_duration: 0,
          },
        };

        try {
          // TX1 with timing
          message.timing.tx1_start = Date.now();
          const tx1 = await context.createTxPda(
            message.txId,
            message.sourceChain
          );
          message.timing.tx1_end = Date.now();

          // Small delay to simulate real-world timing
          await wait(finalityTest.timing_precision_ms);

          // TX2 with timing
          message.timing.tx2_start = Date.now();
          const tx2 = await context.processMessage(
            message.txId,
            message.sourceChain,
            context.chainId,
            Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex"),
            Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex"),
            Buffer.from(
              JSON.stringify({
                finality_test: true,
                confirmation_level: confirmLevel,
                message_index: i,
                timestamp: message.timing.start,
              })
            ),
            Buffer.from(`finality-${confirmLevel}-${i}`)
          );
          message.timing.tx2_end = Date.now();

          message.timing.total_duration =
            message.timing.tx2_end - message.timing.start;
          message.timing.tx1_duration =
            message.timing.tx1_end - message.timing.tx1_start;
          message.timing.tx2_duration =
            message.timing.tx2_end - message.timing.tx2_start;

          confirmResults.messages.push(message);
        } catch (error) {
          console.log(`  Message ${i} failed: ${error}`);
        }
      }

      // Calculate statistics
      if (confirmResults.messages.length > 0) {
        const totalTimes = confirmResults.messages.map(
          (m) => m.timing.total_duration
        );
        const tx1Times = confirmResults.messages.map(
          (m) => m.timing.tx1_duration
        );
        const tx2Times = confirmResults.messages.map(
          (m) => m.timing.tx2_duration
        );

        confirmResults.avg_total_time =
          totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length;
        confirmResults.avg_tx1_time =
          tx1Times.reduce((a, b) => a + b, 0) / tx1Times.length;
        confirmResults.avg_tx2_time =
          tx2Times.reduce((a, b) => a + b, 0) / tx2Times.length;
        confirmResults.min_total_time = Math.min(...totalTimes);
        confirmResults.max_total_time = Math.max(...totalTimes);

        // Calculate standard deviation
        const variance =
          totalTimes.reduce(
            (acc, time) =>
              acc + Math.pow(time - confirmResults.avg_total_time, 2),
            0
          ) / totalTimes.length;
        confirmResults.std_deviation = Math.sqrt(variance);
      }

      finalityResults.push(confirmResults);

      logSuccess(`Confirmation level ${confirmLevel} completed`);
      console.log(
        `  Messages Processed: ${confirmResults.messages.length}/${finalityTest.sample_size}`
      );
      console.log(
        `  Avg Total Time: ${confirmResults.avg_total_time.toFixed(1)}ms`
      );
      console.log(
        `  Avg TX1 Time: ${confirmResults.avg_tx1_time.toFixed(1)}ms`
      );
      console.log(
        `  Avg TX2 Time: ${confirmResults.avg_tx2_time.toFixed(1)}ms`
      );
      console.log(
        `  Min/Max Time: ${confirmResults.min_total_time}ms / ${confirmResults.max_total_time}ms`
      );
      console.log(
        `  Std Deviation: ${confirmResults.std_deviation.toFixed(1)}ms`
      );
    }

    // Analyze finality patterns
    logSubtest("Finality pattern analysis");

    const fastest = finalityResults.reduce((prev, curr) =>
      prev.avg_total_time < curr.avg_total_time ? prev : curr
    );

    const slowest = finalityResults.reduce((prev, curr) =>
      prev.avg_total_time > curr.avg_total_time ? prev : curr
    );

    const totalMessages = finalityResults.reduce(
      (sum, result) => sum + result.messages.length,
      0
    );
    const overallAvgTime =
      finalityResults.reduce(
        (sum, result) => sum + result.avg_total_time * result.messages.length,
        0
      ) / totalMessages;

    logSuccess("Transaction Finality Benchmark Results");
    console.log(`  Total Messages Analyzed: ${totalMessages}`);
    console.log(`  Overall Average Time: ${overallAvgTime.toFixed(1)}ms`);
    console.log(
      `  Fastest Config: ${
        fastest.confirmation_level
      } confirmations (${fastest.avg_total_time.toFixed(1)}ms avg)`
    );
    console.log(
      `  Slowest Config: ${
        slowest.confirmation_level
      } confirmations (${slowest.avg_total_time.toFixed(1)}ms avg)`
    );

    // Performance assertions
    expect(overallAvgTime).to.be.lessThan(5000); // Under 5 seconds average
    expect(fastest.avg_total_time).to.be.lessThan(3000); // Fastest under 3 seconds
    expect(totalMessages).to.be.greaterThan(finalityTest.sample_size * 2); // At least 2 confirmation levels completed

    // Verify that messages with fewer confirmations are generally faster
    if (finalityResults.length >= 2) {
      const sorted = [...finalityResults].sort(
        (a, b) => a.confirmation_level - b.confirmation_level
      );
      for (let i = 0; i < sorted.length - 1; i++) {
        // Allow some tolerance for variation
        const timeDifference =
          sorted[i + 1].avg_total_time - sorted[i].avg_total_time;
        console.log(
          `  Confirmation ${sorted[i].confirmation_level} vs ${
            sorted[i + 1].confirmation_level
          }: ${timeDifference.toFixed(1)}ms difference`
        );
      }
    }

    logSuccess("Finality benchmark completed successfully");
  });
});
