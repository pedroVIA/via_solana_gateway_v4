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

describe("End-to-End Tests - Cross-Chain Message Flows", () => {
  let context: TestContext;

  beforeEach(async () => {
    // Each test gets a unique chain ID to avoid PDA conflicts
    context = new TestContext();
    // Initialize gateway by default for E2E tests
    // Use silent setup to avoid premature logging
    await context.setup({ silent: true });
  });

  afterEach(async () => {
    await context.teardown();
  });

  it("[E2E-001] should simulate complete Ethereum → Solana message flow", async () => {
    logTestHeader("[E2E-001] Complete Ethereum → Solana Message Flow");
    context.showContext();
    logSubtest("Testing Ethereum to Solana cross-chain message");
    
    const txId = new BN(Date.now());
    const sourceChainId = CHAIN_IDS.ETHEREUM_MAINNET;
    const destChainId = context.chainId; // Solana
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex');
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex');
    
    // Simulate realistic Ethereum transaction data
    const ethereumTxData = {
      action: "bridge_transfer",
      token: "USDC",
      amount: "1000000", // 1 USDC (6 decimals)
      recipient: TEST_ADDRESSES.ETH_ADDRESS_2,
      nonce: Date.now()
    };
    
    const onChainData = Buffer.from(JSON.stringify(ethereumTxData));
    const offChainData = Buffer.from(`eth-to-sol-${Date.now()}`);
    
    // Record initial state
    const initialMetrics = {
      transactionCount: context.metrics.transactionCount,
      computeUnits: context.metrics.totalComputeUnits,
      relayerBalance: await context.connection.getBalance(context.relayer!.publicKey)
    };
    
    logSuccess(`Simulating bridge of ${ethereumTxData.amount} ${ethereumTxData.token}`);
    logSuccess(`From Ethereum chain ${sourceChainId} to Solana chain ${destChainId}`);
    
    // Phase 1: Ethereum transaction creates replay protection
    logSubtest("Phase 1: Ethereum relayer creates TX1 (replay protection)");
    const tx1Start = Date.now();
    const tx1 = await context.createTxPda(txId, sourceChainId);
    const tx1Duration = Date.now() - tx1Start;
    const cuUsed1 = await logTransactionWithCU(
      tx1, 
      context.connection, 
      context, 
      "ETH-TX1 (Create TxId PDA)",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    logSuccess(`TX1 execution time: ${tx1Duration}ms`);
    
    // Verify TxId PDA exists and Counter PDA was updated
    const txIdExists = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExists).to.be.true;
    
    const counterAfterTx1 = await context.getCounterPDA(sourceChainId);
    if (counterAfterTx1) {
      expect(counterAfterTx1.sourceChainId.toString()).to.equal(sourceChainId.toString());
      logSuccess(`Counter updated - Highest TX ID: ${counterAfterTx1.highestTxIdSeen.toString()}`);
    }
    
    // Phase 2: Message processing on Solana
    logSubtest("Phase 2: Solana processes cross-chain message (TX2)");
    const tx2Start = Date.now();
    const tx2 = await context.processMessage(
      txId,
      sourceChainId,
      destChainId,
      sender,
      recipient,
      onChainData,
      offChainData
    );
    const tx2Duration = Date.now() - tx2Start;
    const cuUsed2 = await logTransactionWithCU(
      tx2, 
      context.connection, 
      context, 
      "SOL-TX2 (Process Message)",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    logSuccess(`TX2 execution time: ${tx2Duration}ms`);
    
    // Verify message was processed and TxId PDA was closed
    const txIdExistsAfter = await context.txIdPDAExists(sourceChainId, txId);
    expect(txIdExistsAfter).to.be.false;
    
    // Calculate end-to-end metrics
    const finalMetrics = {
      transactionCount: context.metrics.transactionCount,
      computeUnits: context.metrics.totalComputeUnits,
      relayerBalance: await context.connection.getBalance(context.relayer!.publicKey)
    };
    
    const totalDuration = tx1Duration + tx2Duration;
    const txDelta = finalMetrics.transactionCount - initialMetrics.transactionCount;
    const cuDelta = finalMetrics.computeUnits - initialMetrics.computeUnits;
    const balanceDelta = (finalMetrics.relayerBalance - initialMetrics.relayerBalance) / anchor.web3.LAMPORTS_PER_SOL;
    
    expect(txDelta).to.equal(2); // TX1 + TX2
    expect(cuUsed1 + cuUsed2).to.be.greaterThan(0);
    expect(totalDuration).to.be.lessThan(5000); // Should complete within 5 seconds
    expect(cuUsed1).to.be.lessThan(CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5);
    expect(cuUsed2).to.be.lessThan(CU_LIMITS.EXPECTED_PROCESS_MESSAGE * 1.5);
    
    logSuccess("Cross-chain flow completed successfully");
    console.log(`  Total Duration: ${totalDuration}ms`);
    console.log(`  TX1 CU Used: ${cuUsed1}`);
    console.log(`  TX2 CU Used: ${cuUsed2}`);
    console.log(`  Total CU Used: ${cuUsed1 + cuUsed2}`);
    console.log(`  Balance Change: ${balanceDelta.toFixed(6)} SOL`);
    console.log(`  Message: ${ethereumTxData.action} ${ethereumTxData.amount} ${ethereumTxData.token}`);
  });

  it("[E2E-002] should handle bidirectional cross-chain messaging", async () => {
    logTestHeader("[E2E-002] Bidirectional Cross-Chain Messaging");
    context.showContext();
    logSubtest("Testing bidirectional Ethereum ↔ Solana messaging");
    
    const baseTime = Date.now();
    
    // Message 1: Ethereum → Solana
    const eth2solTxId = new BN(baseTime + 1);
    const eth2solData = {
      direction: "ETH_to_SOL",
      operation: "mint",
      token: "USDT",
      amount: "500000" // 0.5 USDT
    };
    
    // Message 2: Solana → Ethereum (return message)
    const sol2ethTxId = new BN(baseTime + 2);
    const sol2ethData = {
      direction: "SOL_to_ETH",
      operation: "burn_confirmation",
      token: "USDT",
      amount: "500000",
      original_tx: eth2solTxId.toString()
    };
    
    logSubtest("Direction 1: ETH → SOL transfer");
    
    // ETH → SOL Flow
    await context.createTxPda(eth2solTxId, CHAIN_IDS.ETHEREUM_MAINNET);
    await context.processMessage(
      eth2solTxId,
      CHAIN_IDS.ETHEREUM_MAINNET,
      context.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(JSON.stringify(eth2solData)),
      Buffer.from("eth-to-sol-bridge")
    );
    
    logSuccess(`ETH → SOL: Transferred ${eth2solData.amount} ${eth2solData.token}`);
    
    // Short delay to simulate real-world timing
    await wait(100);
    
    logSubtest("Direction 2: SOL → ETH confirmation");
    
    // SOL → ETH Flow (simulated as ETH source to SOL destination for program validation)
    // Since program validates dest chain, we simulate this as ETH message processed on Solana
    await context.createTxPda(sol2ethTxId, CHAIN_IDS.ETHEREUM_MAINNET);
    await context.processMessage(
      sol2ethTxId,
      CHAIN_IDS.ETHEREUM_MAINNET, // Source: Ethereum  
      context.chainId, // Destination: Solana (required for program validation)
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(JSON.stringify(sol2ethData)),
      Buffer.from("sol-to-eth-confirmation")
    );
    
    logSuccess(`SOL → ETH: Confirmed ${sol2ethData.amount} ${sol2ethData.token}`);
    
    // Verify both transactions completed
    const eth2solExists = await context.txIdPDAExists(CHAIN_IDS.ETHEREUM_MAINNET, eth2solTxId);
    const sol2ethExists = await context.txIdPDAExists(CHAIN_IDS.ETHEREUM_MAINNET, sol2ethTxId);
    
    expect(eth2solExists).to.be.false; // Should be closed
    expect(sol2ethExists).to.be.false; // Should be closed
    
    // Check counter states for both chains
    const ethCounter = await context.getCounterPDA(CHAIN_IDS.ETHEREUM_MAINNET);
    
    if (ethCounter) {
      expect(ethCounter.sourceChainId.toString()).to.equal(CHAIN_IDS.ETHEREUM_MAINNET.toString());
      logSuccess(`ETH counter - Highest TX: ${ethCounter.highestTxIdSeen.toString()}`);
    }
    
    logSuccess("Bidirectional cross-chain messaging completed successfully");
    console.log(`  ETH → SOL: ${JSON.stringify(eth2solData)}`);
    console.log(`  SOL → ETH: ${JSON.stringify(sol2ethData)}`);
  });

  it("[E2E-003] should handle complex multi-chain routing scenarios", async () => {
    logTestHeader("[E2E-003] Complex Multi-Chain Routing Scenarios");
    context.showContext();
    logSubtest("Testing multi-chain routing: ETH → SOL → BSC");
    
    const baseTime = Date.now();
    const routingData = {
      originalChain: "Ethereum",
      intermediateChain: "Solana", 
      finalChain: "BSC",
      asset: "USDC",
      amount: "1000000",
      route: ["ETH", "SOL", "BSC"]
    };
    
    // Stage 1: Ethereum → Solana
    logSubtest("Stage 1: ETH → SOL (first hop)");
    const stage1TxId = new BN(baseTime + 100);
    const stage1Data = {
      ...routingData,
      stage: 1,
      next_hop: "Solana",
      final_destination: "BSC"
    };
    
    await context.createTxPda(stage1TxId, CHAIN_IDS.ETHEREUM_MAINNET);
    await context.processMessage(
      stage1TxId,
      CHAIN_IDS.ETHEREUM_MAINNET,
      context.chainId, // Solana
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(JSON.stringify(stage1Data)),
      Buffer.from("multi-hop-stage1")
    );
    
    logSuccess(`Stage 1 complete: ${routingData.amount} ${routingData.asset} from ETH to SOL`);
    
    // Stage 2: Solana → BSC (final hop)
    logSubtest("Stage 2: SOL → BSC (final hop)");
    const stage2TxId = new BN(baseTime + 200);
    const stage2Data = {
      ...routingData,
      stage: 2,
      previous_hop: "Solana",
      final_destination: "BSC",
      original_tx: stage1TxId.toString()
    };
    
    // Simulate second hop as BSC source to Solana destination (for program validation)
    await context.createTxPda(stage2TxId, CHAIN_IDS.BSC_MAINNET);
    await context.processMessage(
      stage2TxId,
      CHAIN_IDS.BSC_MAINNET, // BSC as source
      context.chainId, // Solana as destination (required for program validation)
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_3, 'hex'),
      Buffer.from(JSON.stringify(stage2Data)),
      Buffer.from("multi-hop-stage2")
    );
    
    logSuccess(`Stage 2 complete: ${routingData.amount} ${routingData.asset} from SOL to BSC`);
    
    // Verify routing completed
    const stage1Exists = await context.txIdPDAExists(CHAIN_IDS.ETHEREUM_MAINNET, stage1TxId);
    const stage2Exists = await context.txIdPDAExists(CHAIN_IDS.BSC_MAINNET, stage2TxId);
    
    expect(stage1Exists).to.be.false;
    expect(stage2Exists).to.be.false;
    
    // Check all involved chain counters
    const ethCounter = await context.getCounterPDA(CHAIN_IDS.ETHEREUM_MAINNET);
    const bscCounter = await context.getCounterPDA(CHAIN_IDS.BSC_MAINNET);
    
    if (ethCounter && bscCounter) {
      expect(ethCounter.sourceChainId.toString()).to.equal(CHAIN_IDS.ETHEREUM_MAINNET.toString());
      expect(bscCounter.sourceChainId.toString()).to.equal(CHAIN_IDS.BSC_MAINNET.toString());
      
      logSuccess("Multi-chain routing counters updated correctly");
      console.log(`  ETH Counter: ${ethCounter.highestTxIdSeen.toString()}`);
      console.log(`  BSC Counter: ${bscCounter.highestTxIdSeen.toString()}`);
    }
    
    logSuccess("Multi-chain routing completed successfully");
    console.log(`  Route: ${routingData.route.join(" → ")}`);
    console.log(`  Asset: ${routingData.amount} ${routingData.asset}`);
    console.log(`  Stages: ${stage1TxId.toString()} → ${stage2TxId.toString()}`);
  });

  it("[E2E-004] should simulate high-frequency cross-chain arbitrage", async () => {
    logTestHeader("[E2E-004] High-Frequency Cross-Chain Arbitrage");
    context.showContext();
    logSubtest("Testing high-frequency arbitrage across chains");
    
    const baseTime = Date.now();
    const arbitrageOps = [];
    
    // Simulate 5 rapid arbitrage operations
    for (let i = 0; i < 5; i++) {
      const operation = {
        id: baseTime + i * 100,
        sourceChain: i % 2 === 0 ? CHAIN_IDS.ETHEREUM_MAINNET : CHAIN_IDS.POLYGON_MAINNET,
        destChain: context.chainId,
        token: i % 3 === 0 ? "USDC" : i % 3 === 1 ? "USDT" : "DAI",
        amount: `${(i + 1) * 1000000}`, // Varying amounts
        strategy: "price_arbitrage"
      };
      arbitrageOps.push(operation);
    }
    
    const startTime = Date.now();
    
    // Execute all arbitrage operations concurrently for TX1 phase
    logSubtest("Batch TX1: Creating all arbitrage TxId PDAs");
    const tx1Promises = arbitrageOps.map(op => 
      context.createTxPda(new BN(op.id), op.sourceChain)
    );
    
    const tx1Results = await Promise.all(tx1Promises);
    const tx1Duration = Date.now() - startTime;
    
    logSuccess(`TX1 Batch completed in ${tx1Duration}ms`);
    tx1Results.forEach((tx, i) => {
      console.log(`  Arbitrage ${i + 1}: ${tx}`);
    });
    
    // Execute all TX2 operations
    logSubtest("Batch TX2: Processing all arbitrage messages");
    const tx2StartTime = Date.now();
    
    const tx2Promises = arbitrageOps.map(op => 
      context.processMessage(
        new BN(op.id),
        op.sourceChain,
        op.destChain,
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
        Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
        Buffer.from(JSON.stringify({
          strategy: op.strategy,
          token: op.token,
          amount: op.amount,
          source: op.sourceChain.toString(),
          timestamp: op.id
        })),
        Buffer.from(`arbitrage-${op.id}`)
      )
    );
    
    const tx2Results = await Promise.all(tx2Promises);
    const tx2Duration = Date.now() - tx2StartTime;
    
    logSuccess(`TX2 Batch completed in ${tx2Duration}ms`);
    
    // Verify all operations completed
    for (const op of arbitrageOps) {
      const exists = await context.txIdPDAExists(op.sourceChain, new BN(op.id));
      expect(exists).to.be.false; // All should be closed
    }
    
    const totalDuration = Date.now() - startTime;
    const avgTimePerOp = totalDuration / arbitrageOps.length;
    
    // Performance assertions
    expect(totalDuration).to.be.lessThan(10000); // Should complete within 10 seconds
    expect(avgTimePerOp).to.be.lessThan(2000); // Each operation under 2 seconds
    
    logSuccess("High-frequency arbitrage simulation completed");
    console.log(`  Operations: ${arbitrageOps.length}`);
    console.log(`  Total Time: ${totalDuration}ms`);
    console.log(`  Average per Operation: ${avgTimePerOp.toFixed(0)}ms`);
    console.log(`  Throughput: ${(arbitrageOps.length / (totalDuration / 1000)).toFixed(2)} ops/sec`);
    
    // Log token distribution
    const tokenStats = arbitrageOps.reduce((acc, op) => {
      acc[op.token] = (acc[op.token] || 0) + parseInt(op.amount);
      return acc;
    }, {} as Record<string, number>);
    
    console.log(`  Token Volume: ${JSON.stringify(tokenStats)}`);
  });

  it("[E2E-005] should handle cross-chain governance proposals", async () => {
    logTestHeader("[E2E-005] Cross-Chain Governance Proposals");
    context.showContext();
    logSubtest("Testing cross-chain governance proposal execution");
    
    const proposalId = new BN(Date.now());
    const sourceChain = CHAIN_IDS.ETHEREUM_MAINNET; // Governance originates on Ethereum
    
    const governanceProposal = {
      type: "governance_execution",
      proposal_id: proposalId.toString(),
      action: "update_bridge_fee",
      parameters: {
        new_fee_bps: 25, // 0.25% fee
        effective_timestamp: Date.now() + 86400000, // 24 hours
        chains_affected: ["Ethereum", "Solana", "Polygon"]
      },
      signatures_required: 3,
      current_signatures: 3,
      status: "approved"
    };
    
    logSuccess(`Executing governance proposal: ${governanceProposal.action}`);
    logSuccess(`Proposal ID: ${proposalId.toString()}`);
    
    // TX1: Create governance proposal execution
    const tx1 = await context.createTxPda(proposalId, sourceChain);
    const cuUsed1 = await logTransactionWithCU(
      tx1, 
      context.connection, 
      context, 
      "GOV-TX1 (Proposal)",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    
    // TX2: Execute governance proposal
    const tx2 = await context.processMessage(
      proposalId,
      sourceChain,
      context.chainId,
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'), // Governance authority
      Buffer.from("0000000000000000000000000000000000000000", 'hex'), // System recipient
      Buffer.from(JSON.stringify(governanceProposal)),
      Buffer.from("governance-execution")
    );
    const cuUsed2 = await logTransactionWithCU(
      tx2, 
      context.connection, 
      context, 
      "GOV-TX2 (Execute)",
      CU_LIMITS.EXPECTED_PROCESS_MESSAGE
    );
    
    // Verify governance execution completed
    const proposalExists = await context.txIdPDAExists(sourceChain, proposalId);
    expect(proposalExists).to.be.false;
    
    // Check governance counter
    const govCounter = await context.getCounterPDA(sourceChain);
    if (govCounter) {
      expect(govCounter.sourceChainId.toString()).to.equal(sourceChain.toString());
      logSuccess(`Governance counter updated: ${govCounter.highestTxIdSeen.toString()}`);
    }
    
    logSuccess("Cross-chain governance proposal executed successfully");
    console.log(`  Proposal: ${governanceProposal.action}`);
    console.log(`  New Fee: ${governanceProposal.parameters.new_fee_bps} BPS`);
    console.log(`  Affected Chains: ${governanceProposal.parameters.chains_affected.join(", ")}`);
  });

  it("[E2E-006] should simulate real-world DeFi protocol integration", async () => {
    logTestHeader("[E2E-006] Real-World DeFi Protocol Integration");
    context.showContext();
    logSubtest("Testing DeFi protocol cross-chain operations");
    
    const baseTime = Date.now();
    
    // Simulate a complex DeFi operation: Ethereum lending → Solana yield farming
    const defiOperation = {
      protocol: "Via-DeFi-Bridge",
      operation_type: "cross_chain_yield",
      user: TEST_ADDRESSES.ETH_ADDRESS_1,
      source_protocol: "Compound_ETH",
      dest_protocol: "Raydium_SOL",
      assets: [
        { token: "USDC", amount: "10000000000" }, // 10,000 USDC
        { token: "USDT", amount: "5000000000" }   // 5,000 USDT
      ],
      strategy: "maximize_yield",
      min_apy: "8.5%",
      duration: "30_days"
    };
    
    logSuccess(`DeFi Operation: ${defiOperation.source_protocol} → ${defiOperation.dest_protocol}`);
    
    // Stage 1: Withdraw from Ethereum DeFi
    const withdrawTxId = new BN(baseTime + 1000);
    const withdrawData = {
      ...defiOperation,
      stage: "withdraw_source",
      action: "compound_withdraw",
      tokens_withdrawn: defiOperation.assets
    };
    
    await context.createTxPda(withdrawTxId, CHAIN_IDS.ETHEREUM_MAINNET);
    const withdrawTx = await context.processMessage(
      withdrawTxId,
      CHAIN_IDS.ETHEREUM_MAINNET,
      context.chainId,
      Buffer.from(defiOperation.user, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(JSON.stringify(withdrawData)),
      Buffer.from("defi-withdraw")
    );
    
    logSuccess(`Withdrew ${defiOperation.assets.length} tokens from Compound`);
    
    // Stage 2: Deposit to Solana DeFi
    const depositTxId = new BN(baseTime + 2000);
    const depositData = {
      ...defiOperation,
      stage: "deposit_destination",
      action: "raydium_deposit",
      tokens_deposited: defiOperation.assets,
      expected_apy: "12.3%",
      pool_address: "RaydiumPoolExample123456789"
    };
    
    await context.createTxPda(depositTxId, context.chainId);
    const depositTx = await context.processMessage(
      depositTxId,
      context.chainId,
      context.chainId, // Same chain for final deposit
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, 'hex'),
      Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, 'hex'),
      Buffer.from(JSON.stringify(depositData)),
      Buffer.from("defi-deposit")
    );
    
    logSuccess(`Deposited to Raydium pool with ${depositData.expected_apy} APY`);
    
    // Verify both operations completed
    const withdrawExists = await context.txIdPDAExists(CHAIN_IDS.ETHEREUM_MAINNET, withdrawTxId);
    const depositExists = await context.txIdPDAExists(context.chainId, depositTxId);
    
    expect(withdrawExists).to.be.false;
    expect(depositExists).to.be.false;
    
    // Calculate total value transferred
    const totalValue = defiOperation.assets.reduce((sum, asset) => {
      return sum + parseInt(asset.amount);
    }, 0);
    
    logSuccess("DeFi cross-chain yield farming completed");
    console.log(`  Protocol: ${defiOperation.protocol}`);
    console.log(`  Route: ${defiOperation.source_protocol} → ${defiOperation.dest_protocol}`);
    console.log(`  Total Value: ${(totalValue / 1000000).toLocaleString()} USD`);
    console.log(`  Assets: ${defiOperation.assets.map(a => `${a.amount} ${a.token}`).join(", ")}`);
    console.log(`  Target APY: ${defiOperation.min_apy} minimum`);
    console.log(`  Achieved APY: ${depositData.expected_apy}`);
  });
});