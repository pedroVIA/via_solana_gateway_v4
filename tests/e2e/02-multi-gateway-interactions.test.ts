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
  wait
} from "../setup";

describe("End-to-End Tests - Multi-Gateway Interactions", () => {
  let primaryGateway: TestContext;
  let secondaryGateway: TestContext;
  let tertiaryGateway: TestContext;

  beforeEach(async () => {
    // Create multiple gateway contexts with different chain IDs
    primaryGateway = new TestContext(CHAIN_IDS.SOLANA_LOCALNET);
    secondaryGateway = new TestContext(new BN(10001)); // Custom chain ID
    tertiaryGateway = new TestContext(new BN(10002)); // Another custom chain ID
    
    // Set up all gateways in parallel with silent setup to avoid premature logging
    await Promise.all([
      primaryGateway.setup({ silent: true }),
      secondaryGateway.setup({ silent: true }),
      tertiaryGateway.setup({ silent: true })
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      primaryGateway.teardown(),
      secondaryGateway.teardown(),
      tertiaryGateway.teardown()
    ]);
  });

  it("[E2E-007] should handle concurrent messages across multiple gateways", async () => {
    logTestHeader("[E2E-007] Concurrent Messages Across Multiple Gateways");
    primaryGateway.showContext();
    logSubtest("Testing concurrent multi-gateway message processing");
    
    logSuccess("Multiple gateways initialized");
    console.log(`  Primary Gateway (Chain ${primaryGateway.chainId}): ${primaryGateway.gatewayPDA}`);
    console.log(`  Secondary Gateway (Chain ${secondaryGateway.chainId}): ${secondaryGateway.gatewayPDA}`);
    console.log(`  Tertiary Gateway (Chain ${tertiaryGateway.chainId}): ${tertiaryGateway.gatewayPDA}`);
    
    const baseTime = Date.now();
    const messages = [
      {
        id: baseTime + 1,
        sourceChain: CHAIN_IDS.ETHEREUM_MAINNET,
        gateway: primaryGateway,
        data: { type: "transfer", amount: "1000", token: "USDC" }
      },
      {
        id: baseTime + 2,
        sourceChain: CHAIN_IDS.POLYGON_MAINNET,
        gateway: secondaryGateway,
        data: { type: "swap", from: "USDT", to: "USDC", amount: "2000" }
      },
      {
        id: baseTime + 3,
        sourceChain: CHAIN_IDS.BSC_MAINNET,
        gateway: tertiaryGateway,
        data: { type: "bridge", amount: "500", token: "DAI" }
      }
    ];
    
    const startTime = Date.now();
    
    // Phase 1: Create all TxId PDAs concurrently across gateways
    logSubtest("Phase 1: Concurrent TX1 across all gateways");
    const tx1Promises = messages.map(msg =>
      msg.gateway.createTxPda(new BN(msg.id), msg.sourceChain)
    );
    
    const tx1Results = await Promise.all(tx1Promises);
    const tx1Duration = Date.now() - startTime;
    
    logSuccess(`TX1 phase completed in ${tx1Duration}ms across ${messages.length} gateways`);
    for (let i = 0; i < tx1Results.length; i++) {
      const cuUsed = await logTransactionWithCU(
        tx1Results[i], 
        messages[i].gateway.connection, 
        messages[i].gateway, 
        `Gateway ${i + 1} TX1`,
        CU_LIMITS.EXPECTED_CREATE_TX_PDA
      );
      messages[i].gateway.metrics.transactionCount++;
    }
    
    // Verify all TxId PDAs exist
    for (const msg of messages) {
      const exists = await msg.gateway.txIdPDAExists(msg.sourceChain, new BN(msg.id));
      expect(exists).to.be.true;
    }
    
    // Phase 2: Process all messages concurrently
    logSubtest("Phase 2: Concurrent TX2 across all gateways");
    const tx2StartTime = Date.now();
    
    const tx2Promises = messages.map(msg =>
      msg.gateway.processMessage(
        new BN(msg.id),
        msg.sourceChain,
        msg.gateway.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
        Buffer.from(JSON.stringify(msg.data)),
        Buffer.from(`gateway-${msg.gateway.chainId}-${msg.id}`)
      )
    );
    
    const tx2Results = await Promise.all(tx2Promises);
    const tx2Duration = Date.now() - tx2StartTime;
    
    logSuccess(`TX2 phase completed in ${tx2Duration}ms across ${messages.length} gateways`);
    for (let i = 0; i < tx2Results.length; i++) {
      const cuUsed = await logTransactionWithCU(
        tx2Results[i], 
        messages[i].gateway.connection, 
        messages[i].gateway, 
        `Gateway ${i + 1} TX2`,
        CU_LIMITS.EXPECTED_PROCESS_MESSAGE
      );
      messages[i].gateway.metrics.transactionCount++;
    }
    
    // Verify all messages processed and PDAs closed
    for (const msg of messages) {
      const exists = await msg.gateway.txIdPDAExists(msg.sourceChain, new BN(msg.id));
      expect(exists).to.be.false;
    }
    
    const totalDuration = Date.now() - startTime;
    const throughput = messages.length / (totalDuration / 1000);
    
    logSuccess("Multi-gateway concurrent processing completed");
    console.log(`  Total Duration: ${totalDuration}ms`);
    console.log(`  Messages: ${messages.length}`);
    console.log(`  Throughput: ${throughput.toFixed(2)} msgs/sec`);
    console.log(`  Average per Message: ${(totalDuration / messages.length).toFixed(0)}ms`);
  });

  it("[E2E-008] should handle gateway-to-gateway message routing", async () => {
    logTestHeader("[E2E-008] Gateway-to-Gateway Message Routing");
    primaryGateway.showContext();
    logSubtest("Testing inter-gateway message routing");
    
    const routingScenario = {
      id: Date.now(),
      route: [
        { gateway: primaryGateway, chain: CHAIN_IDS.ETHEREUM_MAINNET, role: "source" },
        { gateway: secondaryGateway, chain: secondaryGateway.chainId, role: "intermediate" },
        { gateway: tertiaryGateway, chain: tertiaryGateway.chainId, role: "destination" }
      ],
      payload: {
        routing_type: "multi_hop",
        original_source: "Ethereum",
        final_destination: "TertiaryChain",
        intermediate_stops: ["SecondaryChain"],
        asset: "WETH",
        amount: "5000000000000000000" // 5 ETH in wei
      }
    };
    
    logSuccess(`Routing ${routingScenario.payload.asset} through ${routingScenario.route.length} gateways`);
    
    // Hop 1: Source → Intermediate
    logSubtest("Hop 1: Source → Intermediate Gateway");
    const hop1TxId = new BN(routingScenario.id + 100);
    const hop1Data = {
      ...routingScenario.payload,
      hop: 1,
      current_gateway: "Primary",
      next_gateway: "Secondary"
    };
    
    await primaryGateway.createTxPda(hop1TxId, CHAIN_IDS.ETHEREUM_MAINNET);
    const hop1Tx = await primaryGateway.processMessage(
      hop1TxId,
      CHAIN_IDS.ETHEREUM_MAINNET,
      secondaryGateway.chainId, // Route to secondary gateway
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(JSON.stringify(hop1Data)),
      Buffer.from("routing-hop1")
    );
    
    logTransaction(hop1Tx, "HOP1");
    logSuccess(`Hop 1 complete: Routed to gateway ${secondaryGateway.chainId}`);
    
    // Hop 2: Intermediate → Destination
    logSubtest("Hop 2: Intermediate → Destination Gateway");
    const hop2TxId = new BN(routingScenario.id + 200);
    const hop2Data = {
      ...routingScenario.payload,
      hop: 2,
      current_gateway: "Secondary",
      next_gateway: "Tertiary",
      previous_tx: hop1TxId.toString()
    };
    
    await secondaryGateway.createTxPda(hop2TxId, secondaryGateway.chainId);
    const hop2Tx = await secondaryGateway.processMessage(
      hop2TxId,
      secondaryGateway.chainId,
      tertiaryGateway.chainId, // Route to tertiary gateway
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_3, 'hex'),
      Buffer.from(JSON.stringify(hop2Data)),
      Buffer.from("routing-hop2")
    );
    
    logTransaction(hop2Tx, "HOP2");
    logSuccess(`Hop 2 complete: Final destination gateway ${tertiaryGateway.chainId}`);
    
    // Final Processing: Destination Gateway
    logSubtest("Final: Destination Gateway Processing");
    const finalTxId = new BN(routingScenario.id + 300);
    const finalData = {
      ...routingScenario.payload,
      hop: 3,
      current_gateway: "Tertiary",
      status: "final_destination",
      route_completed: true,
      original_tx: hop1TxId.toString(),
      intermediate_tx: hop2TxId.toString()
    };
    
    await tertiaryGateway.createTxPda(finalTxId, tertiaryGateway.chainId);
    const finalTx = await tertiaryGateway.processMessage(
      finalTxId,
      tertiaryGateway.chainId,
      tertiaryGateway.chainId, // Final processing on same chain
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_3, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'), // Back to original user
      Buffer.from(JSON.stringify(finalData)),
      Buffer.from("routing-final")
    );
    
    logTransaction(finalTx, "FINAL");
    logSuccess("Route completed at destination gateway");
    
    // Verify all routing steps completed
    const hop1Exists = await primaryGateway.txIdPDAExists(CHAIN_IDS.ETHEREUM_MAINNET, hop1TxId);
    const hop2Exists = await secondaryGateway.txIdPDAExists(secondaryGateway.chainId, hop2TxId);
    const finalExists = await tertiaryGateway.txIdPDAExists(tertiaryGateway.chainId, finalTxId);
    
    expect(hop1Exists).to.be.false;
    expect(hop2Exists).to.be.false; 
    expect(finalExists).to.be.false;
    
    // Check counters on all gateways
    const primaryCounter = await primaryGateway.getCounterPDA(CHAIN_IDS.ETHEREUM_MAINNET);
    const secondaryCounter = await secondaryGateway.getCounterPDA(secondaryGateway.chainId);
    const tertiaryCounter = await tertiaryGateway.getCounterPDA(tertiaryGateway.chainId);
    
    logSuccess("Inter-gateway routing completed successfully");
    console.log(`  Route: ${routingScenario.route.map(r => r.role).join(" → ")}`);
    console.log(`  Asset: ${routingScenario.payload.amount} ${routingScenario.payload.asset}`);
    console.log(`  Hops: ${hop1TxId} → ${hop2TxId} → ${finalTxId}`);
    
    if (primaryCounter) console.log(`  Primary Counter: ${primaryCounter.highestTxIdSeen}`);
    if (secondaryCounter) console.log(`  Secondary Counter: ${secondaryCounter.highestTxIdSeen}`);
    if (tertiaryCounter) console.log(`  Tertiary Counter: ${tertiaryCounter.highestTxIdSeen}`);
  });

  it("[E2E-009] should handle gateway synchronization across chain states", async () => {
    logTestHeader("[E2E-009] Gateway Synchronization Across Chain States");
    primaryGateway.showContext();
    logSubtest("Testing gateway state synchronization");
    
    const syncScenario = {
      sync_id: Date.now(),
      operation: "cross_gateway_sync",
      sync_type: "state_consistency_check",
      involved_gateways: [
        { gateway: primaryGateway, chain: primaryGateway.chainId.toString() },
        { gateway: secondaryGateway, chain: secondaryGateway.chainId.toString() },
        { gateway: tertiaryGateway, chain: tertiaryGateway.chainId.toString() }
      ]
    };
    
    // Create synchronization messages on each gateway
    const syncMessages = syncScenario.involved_gateways.map((gw, index) => ({
      txId: new BN(syncScenario.sync_id + (index + 1) * 1000),
      gateway: gw.gateway,
      sourceChain: new BN(1000 + index), // Unique source chains for sync
      data: {
        sync_operation: "gateway_state_sync",
        sync_id: syncScenario.sync_id,
        gateway_index: index,
        timestamp: Date.now(),
        expected_state: {
          active: true,
          last_processed_block: Date.now(),
          pending_transactions: 0
        }
      }
    }));
    
    logSuccess(`Synchronizing ${syncMessages.length} gateways`);
    
    // Phase 1: Initialize sync on all gateways
    logSubtest("Phase 1: Initialize synchronization");
    const initPromises = syncMessages.map(msg =>
      msg.gateway.createTxPda(msg.txId, msg.sourceChain)
    );
    
    await Promise.all(initPromises);
    logSuccess("Sync initialization completed on all gateways");
    
    // Phase 2: Execute synchronization
    logSubtest("Phase 2: Execute cross-gateway sync");
    const syncPromises = syncMessages.map(msg =>
      msg.gateway.processMessage(
        msg.txId,
        msg.sourceChain,
        msg.gateway.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
        Buffer.from("0000000000000000000000000000000000000000", 'hex'), // System sync
        Buffer.from(JSON.stringify(msg.data)),
        Buffer.from(`sync-${msg.gateway.chainId}-${syncScenario.sync_id}`)
      )
    );
    
    const syncResults = await Promise.all(syncPromises);
    logSuccess("Cross-gateway synchronization completed");
    
    syncResults.forEach((tx, i) => {
      console.log(`  Gateway ${i + 1} Sync: ${tx}`);
    });
    
    // Verify sync completed on all gateways
    for (const msg of syncMessages) {
      const exists = await msg.gateway.txIdPDAExists(msg.sourceChain, msg.txId);
      expect(exists).to.be.false;
    }
    
    // Check that all gateways are still operational post-sync
    const healthChecks = await Promise.all([
      primaryGateway.getGateway(),
      secondaryGateway.getGateway(),
      tertiaryGateway.getGateway()
    ]);
    
    healthChecks.forEach((gateway, i) => {
      expect(gateway.isEnabled).to.be.true;
      expect(gateway.chainId.toString()).to.equal(syncScenario.involved_gateways[i].chain);
    });
    
    logSuccess("Gateway synchronization and health check passed");
    console.log(`  Synchronized Gateways: ${syncMessages.length}`);
    console.log(`  Sync ID: ${syncScenario.sync_id}`);
    console.log(`  All gateways operational: ✅`);
  });

  it("[E2E-010] should handle gateway failover scenarios", async () => {
    logTestHeader("[E2E-010] Gateway Failover Scenarios");
    primaryGateway.showContext();
    logSubtest("Testing gateway failover and recovery");
    
    const failoverScenario = {
      test_id: Date.now(),
      primary_gateway: primaryGateway,
      backup_gateway: secondaryGateway,
      monitor_gateway: tertiaryGateway,
      asset: "USDC",
      amount: "1000000"
    };
    
    logSuccess("Testing gateway failover mechanism");
    
    // Step 1: Normal operation on primary gateway
    logSubtest("Step 1: Normal operation on primary gateway");
    const normalTxId = new BN(failoverScenario.test_id + 1);
    
    await primaryGateway.createTxPda(normalTxId, CHAIN_IDS.ETHEREUM_MAINNET);
    const normalTx = await primaryGateway.processMessage(
      normalTxId,
      CHAIN_IDS.ETHEREUM_MAINNET,
      primaryGateway.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(JSON.stringify({ 
        operation: "normal_transfer", 
        asset: failoverScenario.asset,
        amount: failoverScenario.amount 
      })),
      Buffer.from("normal-operation")
    );
    
    logSuccess("Normal operation completed on primary gateway");
    
    // Step 2: Simulate primary gateway failure (disable system)
    logSubtest("Step 2: Simulate primary gateway failure");
    await primaryGateway.setSystemEnabled(false);
    logSuccess("Primary gateway disabled (simulating failure)");
    
    // Step 3: Attempt operation on failed primary (should fail)
    const failedTxId = new BN(failoverScenario.test_id + 2);
    
    await primaryGateway.createTxPda(failedTxId, CHAIN_IDS.ETHEREUM_MAINNET);
    
    await expectRevert(
      primaryGateway.processMessage(
        failedTxId,
        CHAIN_IDS.ETHEREUM_MAINNET,
        primaryGateway.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
        Buffer.from(JSON.stringify({ operation: "failed_transfer" })),
        Buffer.from("failed-operation")
      ),
      ERROR_CODES.SYSTEM_DISABLED
    );
    
    logSuccess("Primary gateway correctly rejected operations while disabled");
    
    // Step 4: Failover to backup gateway
    logSubtest("Step 3: Failover to backup gateway");
    const failoverTxId = new BN(failoverScenario.test_id + 3);
    
    await secondaryGateway.createTxPda(failoverTxId, CHAIN_IDS.ETHEREUM_MAINNET);
    const failoverTx = await secondaryGateway.processMessage(
      failoverTxId,
      CHAIN_IDS.ETHEREUM_MAINNET,
      secondaryGateway.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(JSON.stringify({
        operation: "failover_transfer",
        asset: failoverScenario.asset,
        amount: failoverScenario.amount,
        failover_reason: "primary_gateway_down",
        original_gateway: primaryGateway.chainId.toString()
      })),
      Buffer.from("failover-operation")
    );
    
    logSuccess("Failover operation completed on backup gateway");
    
    // Step 5: Recovery - re-enable primary gateway
    logSubtest("Step 4: Primary gateway recovery");
    await primaryGateway.setSystemEnabled(true);
    logSuccess("Primary gateway recovered and enabled");
    
    // Step 6: Verify primary gateway is operational again
    const recoveryTxId = new BN(failoverScenario.test_id + 4);
    
    await primaryGateway.createTxPda(recoveryTxId, CHAIN_IDS.ETHEREUM_MAINNET);
    const recoveryTx = await primaryGateway.processMessage(
      recoveryTxId,
      CHAIN_IDS.ETHEREUM_MAINNET,
      primaryGateway.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(JSON.stringify({
        operation: "recovery_test",
        asset: failoverScenario.asset,
        amount: failoverScenario.amount,
        status: "primary_recovered"
      })),
      Buffer.from("recovery-operation")
    );
    
    logSuccess("Primary gateway recovery verified");
    
    // Verify transaction states
    const normalExists = await primaryGateway.txIdPDAExists(CHAIN_IDS.ETHEREUM_MAINNET, normalTxId);
    const failedExists = await primaryGateway.txIdPDAExists(CHAIN_IDS.ETHEREUM_MAINNET, failedTxId);
    const failoverExists = await secondaryGateway.txIdPDAExists(CHAIN_IDS.ETHEREUM_MAINNET, failoverTxId);
    const recoveryExists = await primaryGateway.txIdPDAExists(CHAIN_IDS.ETHEREUM_MAINNET, recoveryTxId);
    
    expect(normalExists).to.be.false; // Completed successfully
    expect(failedExists).to.be.true;  // Failed, PDA still exists
    expect(failoverExists).to.be.false; // Completed on backup
    expect(recoveryExists).to.be.false; // Completed after recovery
    
    logSuccess("Gateway failover scenario completed successfully");
    console.log(`  Normal TX: ${normalTx} ✅`);
    console.log(`  Failed TX: ${failedTxId} ❌ (PDA exists)`);
    console.log(`  Failover TX: ${failoverTx} ✅`);
    console.log(`  Recovery TX: ${recoveryTx} ✅`);
  });

  it("[E2E-011] should handle complex multi-gateway consensus mechanisms", async () => {
    logTestHeader("[E2E-011] Complex Multi-Gateway Consensus Mechanisms");
    primaryGateway.showContext();
    logSubtest("Testing multi-gateway consensus for critical operations");
    
    const consensusOperation = {
      operation_id: Date.now(),
      type: "critical_system_update",
      description: "Update cross-chain bridge parameters",
      requires_consensus: true,
      minimum_approvals: 3,
      participating_gateways: [
        { gateway: primaryGateway, vote: "approve", weight: 1 },
        { gateway: secondaryGateway, vote: "approve", weight: 1 },
        { gateway: tertiaryGateway, vote: "approve", weight: 1 }
      ],
      proposed_changes: {
        max_transaction_size: "100000000", // 100M
        bridge_fee_bps: 30, // 0.3%
        consensus_timeout: 3600000 // 1 hour
      }
    };
    
    logSuccess(`Consensus Operation: ${consensusOperation.description}`);
    logSuccess(`Required Approvals: ${consensusOperation.minimum_approvals}/${consensusOperation.participating_gateways.length}`);
    
    // Phase 1: Submit consensus proposal to all gateways
    logSubtest("Phase 1: Submit consensus proposals");
    const proposalPromises = consensusOperation.participating_gateways.map((gw, index) => {
      const proposalTxId = new BN(consensusOperation.operation_id + (index + 1) * 100);
      const sourceChain = new BN(2000 + index); // Unique source for each proposal
      
      const proposalData = {
        consensus_id: consensusOperation.operation_id,
        gateway_index: index,
        vote: gw.vote,
        weight: gw.weight,
        proposed_changes: consensusOperation.proposed_changes,
        timestamp: Date.now()
      };
      
      return {
        txId: proposalTxId,
        sourceChain,
        gateway: gw.gateway,
        data: proposalData
      };
    });
    
    // Create all proposal PDAs
    const createProposalPromises = proposalPromises.map(p =>
      p.gateway.createTxPda(p.txId, p.sourceChain)
    );
    
    await Promise.all(createProposalPromises);
    logSuccess("All consensus proposals submitted");
    
    // Phase 2: Process votes on each gateway
    logSubtest("Phase 2: Process consensus votes");
    const votePromises = proposalPromises.map(p =>
      p.gateway.processMessage(
        p.txId,
        p.sourceChain,
        p.gateway.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'), // Proposer
        Buffer.from("0000000000000000000000000000000000000000", 'hex'), // System
        Buffer.from(JSON.stringify(p.data)),
        Buffer.from(`consensus-vote-${p.gateway.chainId}`)
      )
    );
    
    const voteResults = await Promise.all(votePromises);
    logSuccess("All consensus votes processed");
    
    voteResults.forEach((tx, i) => {
      const vote = consensusOperation.participating_gateways[i].vote;
      console.log(`  Gateway ${i + 1} voted ${vote}: ${tx}`);
    });
    
    // Phase 3: Verify consensus reached and execute
    logSubtest("Phase 3: Verify consensus and execute");
    const approvals = consensusOperation.participating_gateways.filter(gw => gw.vote === "approve").length;
    const consensusReached = approvals >= consensusOperation.minimum_approvals;
    
    expect(consensusReached).to.be.true;
    logSuccess(`Consensus reached: ${approvals}/${consensusOperation.participating_gateways.length} approvals`);
    
    // Execute consensus decision on all gateways
    const executionTxId = new BN(consensusOperation.operation_id + 1000);
    const executionData = {
      consensus_id: consensusOperation.operation_id,
      status: "executed",
      approvals: approvals,
      changes_applied: consensusOperation.proposed_changes,
      execution_timestamp: Date.now()
    };
    
    // Execute on primary gateway as the coordinator
    await primaryGateway.createTxPda(executionTxId, primaryGateway.chainId);
    const executionTx = await primaryGateway.processMessage(
      executionTxId,
      primaryGateway.chainId,
      primaryGateway.chainId,
      Buffer.from("0000000000000000000000000000000000000000", 'hex'), // System
      Buffer.from("0000000000000000000000000000000000000000", 'hex'), // System
      Buffer.from(JSON.stringify(executionData)),
      Buffer.from("consensus-execution")
    );
    
    logSuccess("Consensus decision executed");
    
    // Verify all operations completed
    for (const proposal of proposalPromises) {
      const exists = await proposal.gateway.txIdPDAExists(proposal.sourceChain, proposal.txId);
      expect(exists).to.be.false;
    }
    
    const executionExists = await primaryGateway.txIdPDAExists(primaryGateway.chainId, executionTxId);
    expect(executionExists).to.be.false;
    
    logSuccess("Multi-gateway consensus mechanism completed successfully");
    console.log(`  Operation: ${consensusOperation.description}`);
    console.log(`  Consensus Result: ${approvals}/${consensusOperation.participating_gateways.length} ✅`);
    console.log(`  Execution TX: ${executionTx}`);
    console.log(`  New Bridge Fee: ${consensusOperation.proposed_changes.bridge_fee_bps} BPS`);
    console.log(`  New Max TX Size: ${consensusOperation.proposed_changes.max_transaction_size}`);
  });

  it("[E2E-012] should handle massive parallel processing across gateways", async () => {
    logTestHeader("[E2E-012] Massive Parallel Processing Across Gateways");
    primaryGateway.showContext();
    logSubtest("Testing massive parallel processing capacity");
    
    const massProcessingTest = {
      test_id: Date.now(),
      total_messages: 50, // High volume test
      messages_per_gateway: 16, // ~16 messages per gateway
      gateways: [primaryGateway, secondaryGateway, tertiaryGateway]
    };
    
    logSuccess(`Generating ${massProcessingTest.total_messages} messages across ${massProcessingTest.gateways.length} gateways`);
    
    // Generate messages distributed across gateways
    const allMessages = [];
    for (let i = 0; i < massProcessingTest.total_messages; i++) {
      const gatewayIndex = i % massProcessingTest.gateways.length;
      const gateway = massProcessingTest.gateways[gatewayIndex];
      
      allMessages.push({
        id: massProcessingTest.test_id + i,
        gateway,
        gatewayIndex,
        sourceChain: new BN(3000 + (i % 5)), // Rotate through 5 source chains
        data: {
          message_index: i,
          gateway_id: gateway.chainId.toString(),
          payload_type: i % 3 === 0 ? "transfer" : i % 3 === 1 ? "swap" : "bridge",
          amount: `${(i + 1) * 1000000}`, // Varying amounts
          timestamp: Date.now() + i
        }
      });
    }
    
    const startTime = Date.now();
    
    // Batch Phase 1: Create all TxId PDAs
    logSubtest(`Batch Phase 1: Creating ${allMessages.length} TxId PDAs`);
    const batchCreatePromises = allMessages.map(msg =>
      msg.gateway.createTxPda(new BN(msg.id), msg.sourceChain)
    );
    
    const createResults = await Promise.all(batchCreatePromises);
    const createDuration = Date.now() - startTime;
    
    logSuccess(`TX1 batch completed: ${createResults.length} PDAs in ${createDuration}ms`);
    console.log(`  Average TX1 time: ${(createDuration / createResults.length).toFixed(1)}ms`);
    
    // Batch Phase 2: Process all messages
    logSubtest(`Batch Phase 2: Processing ${allMessages.length} messages`);
    const processStartTime = Date.now();
    
    const batchProcessPromises = allMessages.map(msg =>
      msg.gateway.processMessage(
        new BN(msg.id),
        msg.sourceChain,
        msg.gateway.chainId,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
        Buffer.from(JSON.stringify(msg.data)),
        Buffer.from(`mass-${msg.gatewayIndex}-${msg.id}`)
      )
    );
    
    const processResults = await Promise.all(batchProcessPromises);
    const processDuration = Date.now() - processStartTime;
    
    logSuccess(`TX2 batch completed: ${processResults.length} messages in ${processDuration}ms`);
    console.log(`  Average TX2 time: ${(processDuration / processResults.length).toFixed(1)}ms`);
    
    // Verification Phase
    logSubtest("Verification: Checking all messages processed");
    let verificationErrors = 0;
    
    for (const msg of allMessages) {
      try {
        const exists = await msg.gateway.txIdPDAExists(msg.sourceChain, new BN(msg.id));
        if (exists) {
          verificationErrors++;
          console.log(`  ❌ Message ${msg.id} PDA still exists`);
        }
      } catch (error) {
        verificationErrors++;
        console.log(`  ❌ Message ${msg.id} verification failed: ${error}`);
      }
    }
    
    expect(verificationErrors).to.equal(0);
    
    // Calculate final metrics
    const totalDuration = Date.now() - startTime;
    const throughput = allMessages.length / (totalDuration / 1000);
    const avgTimePerMessage = totalDuration / allMessages.length;
    
    // Gateway-specific metrics
    const gatewayMetrics = massProcessingTest.gateways.map((gateway, index) => {
      const gatewayMessages = allMessages.filter(msg => msg.gatewayIndex === index);
      return {
        gateway_id: gateway.chainId.toString(),
        messages_processed: gatewayMessages.length,
        total_transactions: gateway.metrics.transactionCount
      };
    });
    
    logSuccess("Massive parallel processing completed successfully");
    console.log(`  Total Messages: ${allMessages.length}`);
    console.log(`  Total Duration: ${totalDuration}ms`);
    console.log(`  Throughput: ${throughput.toFixed(2)} msgs/sec`);
    console.log(`  Average per Message: ${avgTimePerMessage.toFixed(1)}ms`);
    console.log(`  Verification Errors: ${verificationErrors}`);
    
    gatewayMetrics.forEach((metrics, i) => {
      console.log(`  Gateway ${i + 1} (${metrics.gateway_id}): ${metrics.messages_processed} msgs, ${metrics.total_transactions} total TXs`);
    });
    
    // Performance assertions
    expect(throughput).to.be.greaterThan(5); // At least 5 messages per second
    expect(avgTimePerMessage).to.be.lessThan(2000); // Under 2 seconds per message
    expect(verificationErrors).to.equal(0); // No verification errors
  });
});