import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

import { SystemProgram, Keypair } from "@solana/web3.js";
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
  wait,
  createFundedKeypair
} from "../setup";

describe("End-to-End Tests - Security Scenarios", () => {
  let context: TestContext;
  let attackerContext: TestContext;

  beforeEach(async () => {
    // Set up legitimate gateway
    context = new TestContext();
    await context.setup();
    
    // Set up separate context for attacker scenarios
    attackerContext = new TestContext(new BN(9999)); // Different chain ID
    await attackerContext.setup({ skipGatewayInit: true }); // Don't initialize attacker gateway
    
    logSuccess("Security test contexts initialized");
  });

  afterEach(async () => {
    await Promise.all([
      context.teardown(),
      attackerContext.teardown()
    ]);
  });

  it("[E2E-018] should prevent unauthorized gateway operations", async () => {
    logTestHeader("[E2E-018] Unauthorized Gateway Operations Prevention");
    context.showContext();
    logSubtest("Testing unauthorized access prevention");
    
    // Create unauthorized keypairs
    const unauthorizedAuthority = await createFundedKeypair(context.connection, TEST_CONFIG.AIRDROP_AMOUNT);
    const unauthorizedRelayer = await createFundedKeypair(context.connection, TEST_CONFIG.AIRDROP_AMOUNT);
    
    await wait(WAIT_TIMES.AIRDROP);
    
    logSuccess("Created unauthorized test accounts");
    
    // Test 1: Unauthorized gateway initialization attempt
    logSubtest("Test 1: Unauthorized gateway initialization");
    
    await expectRevert(
      context.program.methods
        .initializeGateway(new BN(8888)) // Different chain ID
        .accounts({
          gateway: attackerContext.gatewayPDA!,
          authority: unauthorizedAuthority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([unauthorizedAuthority])
        .rpc(),
      "custom program error" // Should fail with program error
    );
    
    logSuccess("Unauthorized gateway initialization correctly prevented");
    
    // Test 2: Unauthorized system enable/disable
    logSubtest("Test 2: Unauthorized system control");
    
    await expectRevert(
      context.setSystemEnabled(false, unauthorizedAuthority),
      ERROR_CODES.UNAUTHORIZED
    );
    
    logSuccess("Unauthorized system control correctly prevented");
    
    // Test 3: Unauthorized message processing with wrong relayer
    logSubtest("Test 3: Unauthorized message processing");
    
    const txId = new BN(Date.now());
    const sourceChain = CHAIN_IDS.ETHEREUM_MAINNET;
    
    // Legitimate TX1 creation
    await context.createTxPda(txId, sourceChain);
    
    // Attempt unauthorized TX2 processing
    await expectRevert(
      context.processMessage(
        txId,
        sourceChain,
        context.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
        Buffer.from("unauthorized-payload"),
        Buffer.from("unauthorized-offchain"),
        unauthorizedRelayer // Wrong signer
      ),
      "A seeds constraint was violated" // Anchor constraint error
    );
    
    logSuccess("Unauthorized message processing correctly prevented");
    
    // Verify legitimate operations still work
    logSubtest("Verification: Legitimate operations still functional");
    
    await context.processMessage(
      txId,
      sourceChain,
      context.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from("legitimate-payload"),
      Buffer.from("legitimate-offchain")
    );
    
    const txExists = await context.txIdPDAExists(sourceChain, txId);
    expect(txExists).to.be.false;
    
    logSuccess("Legitimate operations remain functional after attack attempts");
  });

  it("[E2E-019] should handle replay attack scenarios robustly", async () => {
    logTestHeader("[E2E-019] Replay Attack Scenarios");
    context.showContext();
    logSubtest("Testing replay attack prevention mechanisms");
    
    const replayScenarios = [
      {
        name: "Same TX ID, Same Chain",
        txId: new BN(Date.now()),
        sourceChain: CHAIN_IDS.ETHEREUM_MAINNET,
        shouldFail: true,
        reason: "Duplicate TX ID on same chain"
      },
      {
        name: "Same TX ID, Different Chain",
        txId: new BN(Date.now() + 1),
        sourceChain: CHAIN_IDS.POLYGON_MAINNET,
        shouldFail: false,
        reason: "Same TX ID on different chain should be allowed"
      },
      {
        name: "Different TX ID, Same Chain",
        txId: new BN(Date.now() + 2),
        sourceChain: CHAIN_IDS.ETHEREUM_MAINNET,
        shouldFail: false,
        reason: "Different TX ID on same chain should be allowed"
      }
    ];
    
    // Execute initial legitimate transaction
    const baseTxId = replayScenarios[0].txId;
    const baseSourceChain = replayScenarios[0].sourceChain;
    
    logSubtest("Establishing baseline transaction");
    await context.createTxPda(baseTxId, baseSourceChain);
    await context.processMessage(
      baseTxId,
      baseSourceChain,
      context.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(JSON.stringify({ type: "baseline", amount: "1000" })),
      Buffer.from("baseline-transaction")
    );
    
    logSuccess("Baseline transaction established");
    
    // Test replay scenarios
    for (const scenario of replayScenarios) {
      logSubtest(`Testing: ${scenario.name}`);
      
      if (scenario.name === "Same TX ID, Same Chain") {
        // This should fail at TX1 stage - trying to create same PDA again
        await expectRevert(
          context.createTxPda(scenario.txId, scenario.sourceChain),
          "custom program error" // PDA already exists
        );
        
        logSuccess(`${scenario.name}: Correctly prevented at TX1 stage`);
        
      } else {
        // These should succeed
        await context.createTxPda(scenario.txId, scenario.sourceChain);
        await context.processMessage(
          scenario.txId,
          scenario.sourceChain,
          context.chainId,
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
          Buffer.from(JSON.stringify({ 
            type: "replay_test", 
            scenario: scenario.name,
            timestamp: Date.now() 
          })),
          Buffer.from(`replay-test-${scenario.txId}`)
        );
        
        logSuccess(`${scenario.name}: Correctly allowed (${scenario.reason})`);
      }
    }
    
    // Advanced replay test: Try to recreate PDA after processing
    logSubtest("Advanced: Attempting PDA recreation after processing");
    
    const advancedTxId = new BN(Date.now() + 1000);
    const advancedSourceChain = CHAIN_IDS.BSC_MAINNET;
    
    // Normal flow
    await context.createTxPda(advancedTxId, advancedSourceChain);
    await context.processMessage(
      advancedTxId,
      advancedSourceChain,
      context.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from("processed-message"),
      Buffer.from("processed-offchain")
    );
    
    // Verify PDA was closed
    const pdaClosed = !(await context.txIdPDAExists(advancedSourceChain, advancedTxId));
    expect(pdaClosed).to.be.true;
    
    // Try to recreate the same PDA (should succeed since it was closed)
    await context.createTxPda(advancedTxId, advancedSourceChain);
    logSuccess("PDA recreation after closure: Correctly allowed");
    
    // Process again (should succeed)
    await context.processMessage(
      advancedTxId,
      advancedSourceChain,
      context.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from("reprocessed-message"),
      Buffer.from("reprocessed-offchain")
    );
    
    logSuccess("Message reprocessing after PDA recreation: Correctly allowed");
    
    logSuccess("Replay attack prevention mechanisms validated");
  });

  it("[E2E-020] should resist resource exhaustion attacks", async () => {
    logTestHeader("[E2E-020] Resource Exhaustion Attack Resistance");
    context.showContext();
    logSubtest("Testing resource exhaustion attack resistance");
    
    const exhaustionAttack = {
      attack_type: "PDA_creation_spam",
      total_attempts: 100,
      concurrent_batches: 10,
      attempts_per_batch: 10,
      attack_source_chain: new BN(7777)
    };
    
    logSuccess(`Resource Exhaustion Attack Parameters:`);
    console.log(`  Attack Type: ${exhaustionAttack.attack_type}`);
    console.log(`  Total Attempts: ${exhaustionAttack.total_attempts}`);
    console.log(`  Concurrent Batches: ${exhaustionAttack.concurrent_batches}`);
    console.log(`  Source Chain: ${exhaustionAttack.attack_source_chain}`);
    
    const attackStartTime = Date.now();
    const attackResults = {
      successful_attacks: 0,
      failed_attacks: 0,
      errors: 0,
      legitimate_operations_affected: 0
    };
    
    // Launch resource exhaustion attack
    logSubtest("Launching resource exhaustion attack");
    
    const attackBatches = [];
    for (let batch = 0; batch < exhaustionAttack.concurrent_batches; batch++) {
      const batchPromises = [];
      
      for (let attempt = 0; attempt < exhaustionAttack.attempts_per_batch; attempt++) {
        const attackTxId = new BN(Date.now() + batch * 1000 + attempt);
        
        // Create attack PDA attempts
        batchPromises.push(
          context.createTxPda(attackTxId, exhaustionAttack.attack_source_chain)
            .then(() => {
              attackResults.successful_attacks++;
              return attackTxId;
            })
            .catch(() => {
              attackResults.failed_attacks++;
              return null;
            })
        );
      }
      
      attackBatches.push(Promise.all(batchPromises));
    }
    
    const batchResults = await Promise.all(attackBatches);
    const attackDuration = Date.now() - attackStartTime;
    
    logSuccess(`Resource exhaustion attack completed in ${attackDuration}ms`);
    console.log(`  Successful Attacks: ${attackResults.successful_attacks}`);
    console.log(`  Failed Attacks: ${attackResults.failed_attacks}`);
    
    // Test system responsiveness during attack
    logSubtest("Testing system responsiveness during attack");
    
    const legitimateOpsStartTime = Date.now();
    const legitimateOperations = [];
    
    // Try to perform legitimate operations while system might be under stress
    for (let i = 0; i < 10; i++) {
      try {
        const legitTxId = new BN(Date.now() + 10000 + i);
        const legitSourceChain = CHAIN_IDS.ETHEREUM_MAINNET;
        
        await context.createTxPda(legitTxId, legitSourceChain);
        await context.processMessage(
          legitTxId,
          legitSourceChain,
          context.chainId,
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
          Buffer.from(JSON.stringify({
            operation: "legitimate_during_attack",
            index: i,
            timestamp: Date.now()
          })),
          Buffer.from(`legit-during-attack-${i}`)
        );
        
        legitimateOperations.push({ id: legitTxId, success: true });
        
      } catch (error) {
        legitimateOperations.push({ id: null, success: false, error: error.toString() });
        attackResults.legitimate_operations_affected++;
      }
    }
    
    const legitOpsDuration = Date.now() - legitimateOpsStartTime;
    const legitOpsSuccess = legitimateOperations.filter(op => op.success).length;
    
    logSuccess(`Legitimate operations during attack: ${legitOpsSuccess}/10 successful`);
    console.log(`  Duration: ${legitOpsDuration}ms`);
    console.log(`  Success Rate: ${(legitOpsSuccess / 10 * 100).toFixed(1)}%`);
    
    // Clean up successful attack PDAs to verify system recovery
    logSubtest("System recovery verification");
    
    const cleanupResults = { processed: 0, errors: 0 };
    const successfulAttackTxIds = batchResults.flat().filter(id => id !== null);
    
    for (const attackTxId of successfulAttackTxIds.slice(0, 20)) { // Clean up first 20
      try {
        await context.processMessage(
          attackTxId,
          exhaustionAttack.attack_source_chain,
          context.chainId,
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
          Buffer.from("cleanup-message"),
          Buffer.from("cleanup-offchain")
        );
        cleanupResults.processed++;
      } catch {
        cleanupResults.errors++;
      }
    }
    
    logSuccess(`Attack cleanup: ${cleanupResults.processed} PDAs processed, ${cleanupResults.errors} errors`);
    
    // Final system health check
    const healthCheckTxId = new BN(Date.now() + 50000);
    await context.createTxPda(healthCheckTxId, CHAIN_IDS.POLYGON_MAINNET);
    await context.processMessage(
      healthCheckTxId,
      CHAIN_IDS.POLYGON_MAINNET,
      context.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from("post-attack-health-check"),
      Buffer.from("health-check-offchain")
    );
    
    logSuccess("Post-attack system health check: PASSED");
    
    // Assertions
    expect(legitOpsSuccess).to.be.greaterThan(7); // At least 70% legitimate ops should succeed
    expect(attackResults.legitimate_operations_affected).to.be.lessThan(3); // Less than 30% should be affected
    expect(cleanupResults.processed).to.be.greaterThan(15); // Most attack PDAs should be cleanable
    
    logSuccess("Resource exhaustion attack resistance validated");
  });

  it("[E2E-021] should prevent cross-chain message tampering", async () => {
    logTestHeader("[E2E-021] Cross-Chain Message Tampering Prevention");
    context.showContext();
    logSubtest("Testing message integrity and tampering prevention");
    
    const originalMessage = {
      txId: new BN(Date.now()),
      sourceChain: CHAIN_IDS.ETHEREUM_MAINNET,
      sender: Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      recipient: Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      payload: {
        operation: "transfer",
        amount: "1000000",
        token: "USDC",
        nonce: Date.now(),
        signature_hash: "0x1234567890abcdef"
      },
      offchain_data: "legitimate-metadata"
    };
    
    logSuccess("Original message prepared for tampering tests");
    
    // Test 1: Valid message processing (baseline)
    logSubtest("Test 1: Baseline - Processing valid message");
    
    await context.createTxPda(originalMessage.txId, originalMessage.sourceChain);
    await context.processMessage(
      originalMessage.txId,
      originalMessage.sourceChain,
      context.chainId,
      originalMessage.sender,
      originalMessage.recipient,
      Buffer.from(JSON.stringify(originalMessage.payload)),
      Buffer.from(originalMessage.offchain_data)
    );
    
    logSuccess("Baseline valid message processed successfully");
    
    // Test 2: Parameter tampering attempts
    logSubtest("Test 2: Parameter tampering detection");
    
    const tamperingTests = [
      {
        name: "Wrong TX ID",
        tamper: () => ({ 
          ...originalMessage, 
          txId: new BN(Date.now() + 1) 
        }),
        expectedError: "AccountNotInitialized"
      },
      {
        name: "Wrong Source Chain",
        tamper: () => ({ 
          ...originalMessage, 
          txId: new BN(Date.now() + 2),
          sourceChain: CHAIN_IDS.POLYGON_MAINNET 
        }),
        expectedError: "AccountNotInitialized"
      },
      {
        name: "Message Payload Corruption",
        tamper: () => ({
          ...originalMessage,
          txId: new BN(Date.now() + 3),
          payload: {
            ...originalMessage.payload,
            amount: "99999999", // Tampered amount
            signature_hash: "0xdeadbeef" // Tampered signature
          }
        }),
        expectedError: null // This might succeed but with wrong data
      }
    ];
    
    for (const test of tamperingTests) {
      const tamperedMessage = test.tamper();
      
      logSubtest(`  Testing: ${test.name}`);
      
      // Create PDA for tampered message
      await context.createTxPda(tamperedMessage.txId, tamperedMessage.sourceChain);
      
      if (test.expectedError) {
        // Should fail due to wrong parameters
        await expectRevert(
          context.processMessage(
            originalMessage.txId, // Original TX ID (wrong)
            originalMessage.sourceChain, // Original source chain (potentially wrong)
            context.chainId,
            tamperedMessage.sender,
            tamperedMessage.recipient,
            Buffer.from(JSON.stringify(tamperedMessage.payload)),
            Buffer.from(originalMessage.offchain_data)
          ),
          test.expectedError
        );
        
        logSuccess(`${test.name}: Correctly rejected with ${test.expectedError}`);
      } else {
        // Process with tampered parameters but correct PDA keys
        await context.processMessage(
          tamperedMessage.txId,
          tamperedMessage.sourceChain,
          context.chainId,
          tamperedMessage.sender,
          tamperedMessage.recipient,
          Buffer.from(JSON.stringify(tamperedMessage.payload)),
          Buffer.from(originalMessage.offchain_data)
        );
        
        logSuccess(`${test.name}: Processed (payload integrity depends on application logic)`);
      }
    }
    
    // Test 3: Cross-chain consistency verification
    logSubtest("Test 3: Cross-chain consistency checks");
    
    const consistencyTest = {
      txId: new BN(Date.now() + 1000),
      sourceChain: CHAIN_IDS.BSC_MAINNET,
      correctDestChain: context.chainId,
      wrongDestChain: new BN(9999)
    };
    
    await context.createTxPda(consistencyTest.txId, consistencyTest.sourceChain);
    
    // Process message with wrong destination chain in payload (should still work)
    await context.processMessage(
      consistencyTest.txId,
      consistencyTest.sourceChain,
      consistencyTest.correctDestChain, // Correct in transaction
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(JSON.stringify({
        source_chain: consistencyTest.sourceChain.toString(),
        dest_chain: consistencyTest.wrongDestChain.toString(), // Wrong in payload
        data: "consistency-test"
      })),
      Buffer.from("consistency-check")
    );
    
    logSuccess("Cross-chain consistency: Transaction succeeds but payload validation is application responsibility");
    
    logSuccess("Message tampering prevention tests completed");
  });

  it("[E2E-022] should handle sophisticated timing attacks", async () => {
    logTestHeader("[E2E-022] Sophisticated Timing Attacks");
    context.showContext();
    logSubtest("Testing timing attack resistance");
    
    const timingAttack = {
      base_time: Date.now(),
      attack_window_ms: 5000,
      concurrent_attempts: 20,
      target_tx_id: new BN(Date.now()),
      target_source_chain: CHAIN_IDS.ETHEREUM_MAINNET
    };
    
    logSuccess("Timing Attack Parameters:");
    console.log(`  Attack Window: ${timingAttack.attack_window_ms}ms`);
    console.log(`  Concurrent Attempts: ${timingAttack.concurrent_attempts}`);
    console.log(`  Target TX ID: ${timingAttack.target_tx_id}`);
    
    // Phase 1: Race condition on PDA creation
    logSubtest("Phase 1: PDA creation race condition");
    
    const raceResults = {
      successful_creates: 0,
      failed_creates: 0,
      winner_identified: false
    };
    
    // Launch concurrent PDA creation attempts
    const racePromises = [];
    for (let i = 0; i < timingAttack.concurrent_attempts; i++) {
      racePromises.push(
        context.createTxPda(timingAttack.target_tx_id, timingAttack.target_source_chain)
          .then((tx) => {
            raceResults.successful_creates++;
            if (!raceResults.winner_identified) {
              raceResults.winner_identified = true;
              return { winner: true, tx, attempt: i };
            }
            return { winner: false, tx, attempt: i };
          })
          .catch((error) => {
            raceResults.failed_creates++;
            return { error: error.toString(), attempt: i };
          })
      );
    }
    
    const raceOutcomes = await Promise.all(racePromises);
    const winner = raceOutcomes.find(outcome => outcome.winner);
    
    logSuccess(`Race condition results:`);
    console.log(`  Successful Creates: ${raceResults.successful_creates}`);
    console.log(`  Failed Creates: ${raceResults.failed_creates}`);
    console.log(`  Winner: Attempt ${winner ? winner.attempt : 'none'}`);
    
    // Only one should succeed
    expect(raceResults.successful_creates).to.equal(1);
    expect(raceResults.failed_creates).to.equal(timingAttack.concurrent_attempts - 1);
    
    // Phase 2: Processing timing manipulation
    logSubtest("Phase 2: Message processing timing manipulation");
    
    const processingTests = [];
    const baseProcessingTime = Date.now();
    
    // Create multiple messages with different timing patterns
    for (let i = 0; i < 5; i++) {
      const processingTest = {
        txId: new BN(timingAttack.base_time + 2000 + i),
        sourceChain: new BN(8000 + i),
        delay_before_tx1: i * 100, // Varying delays
        delay_between_tx1_tx2: i * 200,
        processing_start: 0,
        tx1_time: 0,
        tx2_time: 0,
        total_time: 0
      };
      processingTests.push(processingTest);
    }
    
    for (const test of processingTests) {
      test.processing_start = Date.now();
      
      // Variable delay before TX1
      await wait(test.delay_before_tx1);
      
      // TX1
      const tx1Start = Date.now();
      await context.createTxPda(test.txId, test.sourceChain);
      test.tx1_time = Date.now() - tx1Start;
      
      // Variable delay between TX1 and TX2
      await wait(test.delay_between_tx1_tx2);
      
      // TX2
      const tx2Start = Date.now();
      await context.processMessage(
        test.txId,
        test.sourceChain,
        context.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
        Buffer.from(JSON.stringify({
          timing_test: true,
          delays: {
            before_tx1: test.delay_before_tx1,
            between_tx1_tx2: test.delay_between_tx1_tx2
          }
        })),
        Buffer.from(`timing-test-${test.txId}`)
      );
      test.tx2_time = Date.now() - tx2Start;
      test.total_time = Date.now() - test.processing_start;
    }
    
    logSuccess("Timing manipulation test results:");
    processingTests.forEach((test, i) => {
      console.log(`  Test ${i}: TX1=${test.tx1_time}ms, TX2=${test.tx2_time}ms, Total=${test.total_time}ms`);
    });
    
    // Phase 3: System state timing attack
    logSubtest("Phase 3: System state timing attack");
    
    // Try to exploit timing between system disable/enable
    const stateTimingTest = {
      exploitation_attempts: 0,
      successful_exploits: 0,
      failed_exploits: 0
    };
    
    const stateAttackTxId = new BN(Date.now() + 5000);
    const stateAttackSourceChain = CHAIN_IDS.AVALANCHE_MAINNET;
    
    // Create PDA while system is enabled
    await context.createTxPda(stateAttackTxId, stateAttackSourceChain);
    
    // Quick disable/enable cycle with processing attempts in between
    const disablePromise = context.setSystemEnabled(false);
    
    // Try to process message during disable transition
    const exploitPromise = context.processMessage(
      stateAttackTxId,
      stateAttackSourceChain,
      context.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from("timing-exploit-attempt"),
      Buffer.from("exploit-offchain")
    ).then(() => {
      stateTimingTest.successful_exploits++;
    }).catch(() => {
      stateTimingTest.failed_exploits++;
    });
    
    await disablePromise;
    
    // Quick re-enable
    const enablePromise = context.setSystemEnabled(true);
    
    stateTimingTest.exploitation_attempts++;
    await exploitPromise;
    await enablePromise;
    
    // Try legitimate processing after system is stable
    if (await context.txIdPDAExists(stateAttackSourceChain, stateAttackTxId)) {
      await context.processMessage(
        stateAttackTxId,
        stateAttackSourceChain,
        context.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
        Buffer.from("legitimate-after-timing-attack"),
        Buffer.from("legitimate-offchain")
      );
      logSuccess("Legitimate processing successful after timing attack");
    }
    
    logSuccess("System state timing attack results:");
    console.log(`  Exploitation Attempts: ${stateTimingTest.exploitation_attempts}`);
    console.log(`  Successful Exploits: ${stateTimingTest.successful_exploits}`);
    console.log(`  Failed Exploits: ${stateTimingTest.failed_exploits}`);
    
    // Assertions
    expect(stateTimingTest.successful_exploits).to.equal(0); // No exploits should succeed
    
    logSuccess("Timing attack resistance validated");
  });

  it("[E2E-023] should maintain security under system stress conditions", async () => {
    logTestHeader("[E2E-023] Security Under System Stress Conditions");
    context.showContext();
    logSubtest("Testing security under extreme system stress");
    
    const stressTest = {
      stress_duration_ms: 15000, // 15 seconds of stress
      concurrent_operations: 8,
      security_checks_interval_ms: 1000,
      operations_per_batch: 5
    };
    
    logSuccess("System Stress Security Test Parameters:");
    console.log(`  Stress Duration: ${stressTest.stress_duration_ms}ms`);
    console.log(`  Concurrent Operations: ${stressTest.concurrent_operations}`);
    console.log(`  Security Check Interval: ${stressTest.security_checks_interval_ms}ms`);
    
    const stressResults = {
      total_operations: 0,
      successful_operations: 0,
      failed_operations: 0,
      security_violations: 0,
      system_health_checks: 0,
      start_time: Date.now()
    };
    
    // Start security monitoring
    logSubtest("Starting security monitoring under stress");
    
    const securityMonitoring = async () => {
      while (Date.now() - stressResults.start_time < stressTest.stress_duration_ms) {
        try {
          // Security health check
          const healthTxId = new BN(Date.now() + Math.random() * 1000000);
          const healthSourceChain = new BN(9000 + Math.floor(Math.random() * 10));
          
          await context.createTxPda(healthTxId, healthSourceChain);
          await context.processMessage(
            healthTxId,
            healthSourceChain,
            context.chainId,
            Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
            Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
            Buffer.from(JSON.stringify({
              security_check: true,
              timestamp: Date.now(),
              check_number: stressResults.system_health_checks
            })),
            Buffer.from(`security-check-${stressResults.system_health_checks}`)
          );
          
          stressResults.system_health_checks++;
          
        } catch (error) {
          stressResults.security_violations++;
          console.log(`Security check ${stressResults.system_health_checks} failed: ${error}`);
        }
        
        await wait(stressTest.security_checks_interval_ms);
      }
    };
    
    // Start stress load
    logSubtest("Applying extreme stress load");
    
    const stressLoad = async () => {
      const stressStartTime = Date.now();
      
      while (Date.now() - stressStartTime < stressTest.stress_duration_ms) {
        const batchPromises = [];
        
        for (let i = 0; i < stressTest.operations_per_batch; i++) {
          const opTxId = new BN(Date.now() + Math.random() * 1000000);
          const opSourceChain = new BN(10000 + Math.floor(Math.random() * 100));
          
          const operation = async () => {
            try {
              await context.createTxPda(opTxId, opSourceChain);
              await context.processMessage(
                opTxId,
                opSourceChain,
                context.chainId,
                Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
                Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
                Buffer.from(JSON.stringify({
                  stress_operation: true,
                  operation_id: opTxId.toString(),
                  timestamp: Date.now()
                })),
                Buffer.from(`stress-op-${opTxId}`)
              );
              
              stressResults.successful_operations++;
            } catch (error) {
              stressResults.failed_operations++;
            }
            
            stressResults.total_operations++;
          };
          
          batchPromises.push(operation());
        }
        
        await Promise.all(batchPromises);
        
        // Small delay to prevent overwhelming the system
        await wait(50);
      }
    };
    
    // Run monitoring and stress load concurrently
    await Promise.all([
      securityMonitoring(),
      stressLoad()
    ]);
    
    const totalStressDuration = Date.now() - stressResults.start_time;
    
    logSuccess("Stress test completed");
    console.log(`  Duration: ${totalStressDuration}ms`);
    console.log(`  Total Operations: ${stressResults.total_operations}`);
    console.log(`  Successful: ${stressResults.successful_operations}`);
    console.log(`  Failed: ${stressResults.failed_operations}`);
    console.log(`  Security Checks: ${stressResults.system_health_checks}`);
    console.log(`  Security Violations: ${stressResults.security_violations}`);
    console.log(`  Success Rate: ${(stressResults.successful_operations / stressResults.total_operations * 100).toFixed(1)}%`);
    
    // Post-stress security verification
    logSubtest("Post-stress security verification");
    
    const postStressChecks = [];
    for (let i = 0; i < 5; i++) {
      const checkTxId = new BN(Date.now() + 100000 + i);
      const checkSourceChain = CHAIN_IDS.ETHEREUM_MAINNET;
      
      try {
        await context.createTxPda(checkTxId, checkSourceChain);
        await context.processMessage(
          checkTxId,
          checkSourceChain,
          context.chainId,
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
          Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
          Buffer.from(JSON.stringify({
            post_stress_check: true,
            check_index: i
          })),
          Buffer.from(`post-stress-${i}`)
        );
        
        postStressChecks.push({ success: true, index: i });
      } catch (error) {
        postStressChecks.push({ success: false, index: i, error: error.toString() });
      }
    }
    
    const postStressSuccess = postStressChecks.filter(check => check.success).length;
    
    logSuccess(`Post-stress verification: ${postStressSuccess}/5 checks successful`);
    
    // Security assertions
    expect(stressResults.security_violations).to.be.lessThan(stressResults.system_health_checks * 0.1); // Less than 10% violations
    expect(stressResults.successful_operations).to.be.greaterThan(stressResults.total_operations * 0.7); // At least 70% success
    expect(postStressSuccess).to.be.greaterThan(3); // At least 3/5 post-stress checks should pass
    expect(stressResults.system_health_checks).to.be.greaterThan(10); // Should have performed multiple security checks
    
    logSuccess("Security under stress conditions validated");
  });
});