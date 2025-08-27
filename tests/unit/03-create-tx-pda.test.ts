import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

import { SystemProgram } from "@solana/web3.js";
import { 
  TestContext,
  CHAIN_IDS,
  CU_LIMITS,
  ERROR_CODES,
  TEST_CONFIG,
  logTestHeader,
  logSubtest,
  logSuccess,
  logTransactionWithCU,
  expectRevert
} from "../setup";

describe("Unit Tests - Create TX PDA", () => {
  let context: TestContext;

  beforeEach(async () => {
    // Each test gets a unique chain ID to avoid PDA conflicts
    context = new TestContext();
    // Initialize gateway by default
    // Use silent setup to avoid premature logging
    await context.setup({ silent: true });
  });

  afterEach(async () => {
    await context.teardown();
  });

  it("[CREATE-001] should create TxId PDA with valid parameters and counter tracking", async () => {
    logTestHeader("[CREATE-001] Valid TxId PDA Creation and Counter Tracking");
    context.showContext();
    logSubtest("Testing valid TxId PDA creation with state verification");
    
    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 1000000); // Unique source chain ID
    
    const tx = await context.createTxPda(txId, sourceChainId);
    
    const cuUsed = await logTransactionWithCU(
      tx, 
      context.connection, 
      context, 
      "Create TxId PDA",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    context.metrics.transactionCount++;
    
    // Verify TxId PDA was created
    const txIdPDA = await context.getTxIdPDA(sourceChainId, txId);
    expect(txIdPDA.txId.toString()).to.equal(txId.toString());
    expect(txIdPDA.bump).to.be.greaterThan(0);
    
    // Verify Counter PDA was created/updated
    const counterPDA = await context.getCounterPDA(sourceChainId);
    expect(counterPDA.sourceChainId.toString()).to.equal(sourceChainId.toString());
    expect(counterPDA.highestTxIdSeen.toString()).to.equal(txId.toString());
    expect(counterPDA.bump).to.be.greaterThan(0);
    
    // Performance check
    expect(cuUsed).to.be.lessThan(CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5, 
      `Used ${cuUsed} CU, expected <${CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5}`);
    
    logSuccess("TxId PDA created successfully");
    console.log(`  TX ID: ${txId.toString()}`);
    console.log(`  Source Chain ID: ${sourceChainId.toString()}`);
    console.log(`  TxId PDA Bump: ${txIdPDA.bump}`);
    console.log(`  Counter PDA Bump: ${counterPDA.bump}`);
  });

  it("[CREATE-002] should prevent duplicate TxId PDA creation attacks", async () => {
    logTestHeader("[CREATE-002] Duplicate TxId PDA Creation Prevention");
    context.showContext();
    logSubtest("Testing duplicate TxId PDA creation prevention");
    
    const txId = new BN(Date.now() + 1000);
    const sourceChainId = new BN(Date.now() + 2000000); // Unique source chain ID
    
    // First creation - should succeed
    const tx1 = await context.createTxPda(txId, sourceChainId);
    logSuccess("First TxId PDA creation succeeded");
    
    // Second creation with same tx_id and source_chain_id - should fail
    await expectRevert(
      context.createTxPda(txId, sourceChainId),
      "already in use" // Solana's error for account already initialized
    );
    
    logSuccess("Duplicate TxId PDA creation correctly prevented");
  });

  it("[CREATE-003] should handle different source chain IDs with isolation", async () => {
    logTestHeader("[CREATE-003] Multi-Chain Source ID Isolation");
    context.showContext();
    logSubtest("Testing TxId PDA creation for different source chains");
    
    const txId = new BN(Date.now() + 2000);
    const baseChainId = Date.now() + 3000000;
    const testCases = [
      { chainId: new BN(baseChainId + 1), name: "Ethereum" },
      { chainId: new BN(baseChainId + 2), name: "Polygon" },
      { chainId: new BN(baseChainId + 3), name: "BSC" },
      { chainId: new BN(baseChainId + 4), name: "Avalanche" },
    ];
    
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const uniqueTxId = new BN(txId.toNumber() + i);
      
      const tx = await context.createTxPda(uniqueTxId, testCase.chainId);
      
      // Verify TxId PDA was created for this chain
      const txIdPDA = await context.getTxIdPDA(testCase.chainId, uniqueTxId);
      expect(txIdPDA.txId.toString()).to.equal(uniqueTxId.toString());
      
      // Verify Counter PDA was created for this chain
      const counterPDA = await context.getCounterPDA(testCase.chainId);
      expect(counterPDA.sourceChainId.toString()).to.equal(testCase.chainId.toString());
      expect(counterPDA.highestTxIdSeen.toString()).to.equal(uniqueTxId.toString());
      
      console.log(`  ✓ ${testCase.name}: TX ${uniqueTxId.toString()} -> ${tx.substring(0, 8)}...`);
    }
    
    logSuccess("All source chain IDs handled correctly");
  });

  it("[CREATE-004] should update counter PDA with highest tx_id seen", async () => {
    logTestHeader("[CREATE-004] Counter PDA TX ID Tracking Logic");
    context.showContext();
    logSubtest("Testing counter PDA tx_id tracking");
    
    const sourceChainId = new BN(Date.now() + 4000000); // Unique source chain ID
    const baseTime = Date.now() + 3000;
    const txIds = [
      new BN(baseTime + 100),
      new BN(baseTime + 50),  // Lower than first
      new BN(baseTime + 200), // Higher than first
      new BN(baseTime + 75),  // Between first and third
    ];
    
    let expectedHighest = new BN(0);
    
    for (let i = 0; i < txIds.length; i++) {
      const txId = txIds[i];
      const tx = await context.createTxPda(txId, sourceChainId);
      
      // Update expected highest
      if (txId.gt(expectedHighest)) {
        expectedHighest = txId;
      }
      
      // Verify counter shows correct highest
      const counterPDA = await context.getCounterPDA(sourceChainId);
      expect(counterPDA.highestTxIdSeen.toString()).to.equal(expectedHighest.toString());
      
      console.log(`  ✓ TX ${txId.toString()} -> Highest: ${counterPDA.highestTxIdSeen.toString()}`);
    }
    
    logSuccess("Counter PDA correctly tracks highest tx_id seen");
  });

  it("[CREATE-005] should create separate counters for different source chains", async () => {
    logTestHeader("[CREATE-005] Separate Counter PDA Chain Isolation");
    context.showContext();
    logSubtest("Testing separate counter PDAs for different chains");
    
    const baseTime = Date.now() + 5000000;
    const txId1 = new BN(Date.now() + 4000);
    const txId2 = new BN(Date.now() + 5000);
    const chain1 = new BN(baseTime + 1);
    const chain2 = new BN(baseTime + 2);
    
    // Create TxId PDA for first chain
    await context.createTxPda(txId1, chain1);
    
    // Create TxId PDA for second chain
    await context.createTxPda(txId2, chain2);
    
    // Verify separate counter PDAs were created
    const counter1 = await context.getCounterPDA(chain1);
    const counter2 = await context.getCounterPDA(chain2);
    
    expect(counter1.sourceChainId.toString()).to.equal(chain1.toString());
    expect(counter1.highestTxIdSeen.toString()).to.equal(txId1.toString());
    
    expect(counter2.sourceChainId.toString()).to.equal(chain2.toString());
    expect(counter2.highestTxIdSeen.toString()).to.equal(txId2.toString());
    
    // Verify they are different PDAs
    const pdas1 = context.getMessagePDAs(chain1, txId1);
    const pdas2 = context.getMessagePDAs(chain2, txId2);
    expect(pdas1.counterPDA.toString()).to.not.equal(pdas2.counterPDA.toString());
    
    logSuccess("Separate counter PDAs created for different chains");
    console.log(`  Chain ${chain1.toString()} Counter: ${pdas1.counterPDA.toString()}`);
    console.log(`  Chain ${chain2.toString()} Counter: ${pdas2.counterPDA.toString()}`);
  });

  it("[CREATE-006] should allow same tx_id for different source chains", async () => {
    logTestHeader("[CREATE-006] Cross-Chain TX ID Reuse Permission");
    context.showContext();
    logSubtest("Testing same tx_id across different source chains");
    
    const baseTime = Date.now() + 6000000;
    const txId = new BN(Date.now() + 6000);
    const chain1 = new BN(baseTime + 1);
    const chain2 = new BN(baseTime + 2);
    
    // Create TxId PDA for same tx_id on different chains - should both succeed
    const tx1 = await context.createTxPda(txId, chain1);
    const tx2 = await context.createTxPda(txId, chain2);
    
    // Verify both TxId PDAs exist
    const txIdPDA1 = await context.getTxIdPDA(chain1, txId);
    const txIdPDA2 = await context.getTxIdPDA(chain2, txId);
    
    expect(txIdPDA1.txId.toString()).to.equal(txId.toString());
    expect(txIdPDA2.txId.toString()).to.equal(txId.toString());
    
    // Verify they are different PDAs
    const pdas1 = context.getMessagePDAs(chain1, txId);
    const pdas2 = context.getMessagePDAs(chain2, txId);
    expect(pdas1.txIdPDA.toString()).to.not.equal(pdas2.txIdPDA.toString());
    
    logSuccess("Same tx_id allowed for different source chains");
    console.log(`  TX ID: ${txId.toString()}`);
    console.log(`  Chain ${chain1.toString()} PDA: ${pdas1.txIdPDA.toString()}`);
    console.log(`  Chain ${chain2.toString()} PDA: ${pdas2.txIdPDA.toString()}`);
  });

  it("[CREATE-007] should handle large transaction IDs", async () => {
    logTestHeader("[CREATE-007] Large Transaction ID Boundary Testing");
    context.showContext();
    logSubtest("Testing large transaction ID handling");
    
    const largeTxId = new BN("340282366920938463463374607431768211455"); // Max u128
    const sourceChainId = new BN(Date.now() + 7000000); // Unique source chain ID
    
    const tx = await context.createTxPda(largeTxId, sourceChainId);
    
    const cuUsed = await logTransactionWithCU(
      tx, 
      context.connection, 
      context, 
      "Large TX ID",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    context.metrics.transactionCount++;
    
    // Verify TxId PDA was created with large tx_id
    const txIdPDA = await context.getTxIdPDA(sourceChainId, largeTxId);
    expect(txIdPDA.txId.toString()).to.equal(largeTxId.toString());
    
    // Verify Counter PDA was updated with large tx_id
    const counterPDA = await context.getCounterPDA(sourceChainId);
    expect(counterPDA.highestTxIdSeen.toString()).to.equal(largeTxId.toString());
    
    // Performance check
    expect(cuUsed).to.be.lessThan(CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5, 
      `Large TX ID used ${cuUsed} CU, expected <${CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5}`);
    
    logSuccess("Large transaction ID handled correctly");
    console.log(`  Large TX ID: ${largeTxId.toString()}`);
  });

  it("[CREATE-008] should validate PDA derivation is correct", async () => {
    logTestHeader("[CREATE-008] PDA Derivation Correctness Validation");
    context.showContext();
    logSubtest("Testing PDA derivation correctness");
    
    const txId = new BN(Date.now() + 7000);
    const sourceChainId = new BN(Date.now() + 8000000); // Unique source chain ID
    
    // Get expected PDAs before creation
    const expectedPDAs = context.getMessagePDAs(sourceChainId, txId);
    
    // Create the TxId PDA
    const tx = await context.createTxPda(txId, sourceChainId);
    
    // Verify the created accounts match expected PDAs
    const accountInfo1 = await context.connection.getAccountInfo(expectedPDAs.txIdPDA);
    const accountInfo2 = await context.connection.getAccountInfo(expectedPDAs.counterPDA);
    
    expect(accountInfo1).to.not.be.null;
    expect(accountInfo2).to.not.be.null;
    
    // Verify accounts are owned by our program
    expect(accountInfo1!.owner.toString()).to.equal(context.program.programId.toString());
    expect(accountInfo2!.owner.toString()).to.equal(context.program.programId.toString());
    
    logSuccess("PDA derivation is correct");
    console.log(`  TxId PDA: ${expectedPDAs.txIdPDA.toString()}`);
    console.log(`  Counter PDA: ${expectedPDAs.counterPDA.toString()}`);
    console.log(`  TxId Bump: ${expectedPDAs.txIdBump}`);
    console.log(`  Counter Bump: ${expectedPDAs.counterBump}`);
  });

  it("[CREATE-009] should work with different relayer accounts", async () => {
    logTestHeader("[CREATE-009] Multi-Relayer Account Support");
    context.showContext();
    logSubtest("Testing TxId PDA creation with different relayers");
    
    const txId = new BN(Date.now() + 8000);
    const sourceChainId = new BN(Date.now() + 9000000); // Unique source chain ID
    
    // Use the unauthorized user as a different relayer
    const tx = await context.createTxPda(txId, sourceChainId, context.unauthorizedUser!);
    
    const cuUsed = await logTransactionWithCU(
      tx, 
      context.connection, 
      context, 
      "Different Relayer",
      CU_LIMITS.EXPECTED_CREATE_TX_PDA
    );
    context.metrics.transactionCount++;
    
    // Verify TxId PDA was created successfully
    const txIdPDA = await context.getTxIdPDA(sourceChainId, txId);
    expect(txIdPDA.txId.toString()).to.equal(txId.toString());
    
    // Performance check
    expect(cuUsed).to.be.lessThan(CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5, 
      `Different relayer used ${cuUsed} CU, expected <${CU_LIMITS.EXPECTED_CREATE_TX_PDA * 1.5}`);
    
    logSuccess("TxId PDA creation works with different relayers");
  });

  it("[CREATE-010] should preserve existing counter when creating new TxId PDA", async () => {
    logTestHeader("[CREATE-010] Counter Preservation Across Multiple TxId PDAs");
    context.showContext();
    logSubtest("Testing counter preservation with multiple TxId PDAs");
    
    // Use a unique source chain ID to avoid conflicts with other tests
    const sourceChainId = new BN(Date.now() + 10000);
    const txId1 = new BN(Date.now() + 9000);
    const txId2 = new BN(Date.now() + 9100);
    
    // Create first TxId PDA (initializes counter)
    await context.createTxPda(txId1, sourceChainId);
    
    // Verify initial counter state
    let counterPDA = await context.getCounterPDA(sourceChainId);
    const initialBump = counterPDA.bump;
    expect(counterPDA.sourceChainId.toString()).to.equal(sourceChainId.toString());
    expect(counterPDA.highestTxIdSeen.toString()).to.equal(txId1.toString());
    
    // Create second TxId PDA (should preserve counter)
    await context.createTxPda(txId2, sourceChainId);
    
    // Verify counter was preserved and updated
    counterPDA = await context.getCounterPDA(sourceChainId);
    expect(counterPDA.sourceChainId.toString()).to.equal(sourceChainId.toString());
    expect(counterPDA.highestTxIdSeen.toString()).to.equal(txId2.toString());
    expect(counterPDA.bump).to.equal(initialBump); // Bump should remain the same
    
    // Verify both TxId PDAs exist
    expect(await context.txIdPDAExists(sourceChainId, txId1)).to.be.true;
    expect(await context.txIdPDAExists(sourceChainId, txId2)).to.be.true;
    
    logSuccess("Counter preserved across multiple TxId PDA creations");
    console.log(`  First TX: ${txId1.toString()}`);
    console.log(`  Second TX: ${txId2.toString()}`);
    console.log(`  Final highest: ${counterPDA.highestTxIdSeen.toString()}`);
  });
});