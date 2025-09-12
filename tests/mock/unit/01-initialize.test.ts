import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";

import { SystemProgram } from "@solana/web3.js";
import {
  TestContext,
  CHAIN_IDS,
  CU_LIMITS,
  logTestHeader,
  logSubtest,
  logSuccess,
  logTransactionWithCU,
  expectRevert,
} from "../../setup";

describe("Unit Tests - Gateway Initialization", () => {
  let context: TestContext;

  beforeEach(async () => {
    // Each test gets a unique chain ID to avoid PDA conflicts
    context = new TestContext();
    // Skip gateway initialization in setup since we want to test it
    // Use silent setup to avoid premature logging
    await context.setup({ skipGatewayInit: true, silent: true });
  });

  afterEach(async () => {
    await context.teardown();
  });

  it("[INIT-001] should initialize gateway with correct parameters and default state", async () => {
    logTestHeader("[INIT-001] Gateway Initialization with Correct Parameters");
    context.showContext();
    logSubtest("Testing valid gateway initialization");

    // Initialize gateway
    const tx = await context.program.methods
      .initializeGateway(context.chainId)
      .accounts({
        gateway: context.gatewayPDA!,
        authority: context.authority!.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([context.authority!])
      .rpc();

    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "Gateway Initialize",
      CU_LIMITS.EXPECTED_INITIALIZE
    );
    context.metrics.transactionCount++;

    // Verify gateway state
    const gatewayAccount = await context.getGateway();

    expect(gatewayAccount.authority.toString()).to.equal(
      context.authority!.publicKey.toString()
    );
    expect(gatewayAccount.chainId.toString()).to.equal(
      context.chainId.toString()
    );
    expect(gatewayAccount.systemEnabled).to.be.true;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_INITIALIZE * 1.5,
      `Used ${cuUsed} CU, expected <${CU_LIMITS.EXPECTED_INITIALIZE * 1.5}`
    );

    logSuccess("Gateway initialized successfully");
  });

  it("[INIT-002] should prevent duplicate initialization attacks", async () => {
    logTestHeader("[INIT-002] Duplicate Initialization Prevention");
    context.showContext();
    logSubtest("Testing duplicate initialization prevention");

    // First initialization - should succeed
    const tx1 = await context.program.methods
      .initializeGateway(context.chainId)
      .accounts({
        gateway: context.gatewayPDA!,
        authority: context.authority!.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([context.authority!])
      .rpc();

    const cuUsed1 = await logTransactionWithCU(
      tx1,
      context.connection,
      context,
      "First Initialize",
      CU_LIMITS.EXPECTED_INITIALIZE
    );
    context.metrics.transactionCount++;
    logSuccess("First initialization succeeded");

    // Second initialization - should fail
    await expectRevert(
      context.program.methods
        .initializeGateway(context.chainId)
        .accounts({
          gateway: context.gatewayPDA!,
          authority: context.authority!.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([context.authority!])
        .rpc(),
      "already in use" // Solana's error for account already initialized
    );

    logSuccess("Duplicate initialization correctly prevented");
  });

  it("[INIT-003] should create PDA with correct seeds and program ownership", async () => {
    logTestHeader("[INIT-003] PDA Creation with Correct Seeds");
    context.showContext();
    logSubtest("Verifying PDA derivation and bump seed");

    // Initialize gateway
    const tx = await context.program.methods
      .initializeGateway(context.chainId)
      .accounts({
        gateway: context.gatewayPDA!,
        authority: context.authority!.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([context.authority!])
      .rpc();

    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "PDA Initialize",
      CU_LIMITS.EXPECTED_INITIALIZE
    );
    context.metrics.transactionCount++;

    // Verify the PDA was created at the expected address
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount).to.not.be.null;

    // Check that the account is owned by our program
    const accountInfo = await context.connection.getAccountInfo(
      context.gatewayPDA!
    );
    expect(accountInfo!.owner.toString()).to.equal(
      context.program.programId.toString()
    );

    // Performance assertion
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_INITIALIZE * 1.5,
      `PDA initialization used ${cuUsed} CU, expected ~${CU_LIMITS.EXPECTED_INITIALIZE} CU`
    );

    logSuccess("PDA created with correct seeds and program ownership");
    console.log(`  PDA Address: ${context.gatewayPDA!.toString()}`);
    console.log(`  Program Owner: ${accountInfo!.owner.toString()}`);
    console.log(`  Bump Seed: ${context.gatewayBump}`);
  });

  it("[INIT-004] should reject initialization with mismatched chain ID seeds", async () => {
    logTestHeader("[INIT-004] Chain ID Seed Validation");
    context.showContext();
    logSubtest("Testing initialization with mismatched chain ID");

    // Try to initialize with a different chain ID than what the PDA was derived for
    const differentChainId = CHAIN_IDS.ETHEREUM_MAINNET;

    await expectRevert(
      context.program.methods
        .initializeGateway(differentChainId)
        .accounts({
          gateway: context.gatewayPDA!, // This PDA was derived for SOLANA_LOCALNET
          authority: context.authority!.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([context.authority!])
        .rpc(),
      "ConstraintSeeds" // Anchor's error for seed mismatch
    );

    logSuccess("Initialization with wrong chain ID correctly rejected");
  });

  it("[INIT-005] should handle multiple chain IDs with isolated PDAs", async () => {
    logTestHeader("[INIT-005] Multiple Chain IDs with Isolated PDAs");
    context.showContext();
    logSubtest("Testing initialization with different valid chain IDs");

    // Test with unique chain IDs to avoid conflicts
    const testChainId1 = new anchor.BN(Date.now() + 1000);
    const testChainId2 = new anchor.BN(Date.now() + 2000);

    // Test with first chain ID
    const context1 = new TestContext(testChainId1);
    await context1.setup({ skipGatewayInit: true });

    const tx1 = await context1.program.methods
      .initializeGateway(context1.chainId)
      .accounts({
        gateway: context1.gatewayPDA!,
        authority: context1.authority!.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([context1.authority!])
      .rpc();

    const cuUsed1 = await logTransactionWithCU(
      tx1,
      context1.connection,
      context1,
      "Chain1 Initialize",
      CU_LIMITS.EXPECTED_INITIALIZE
    );

    const gateway1 = await context1.getGateway();
    expect(gateway1.chainId.toString()).to.equal(testChainId1.toString());

    // Test with second chain ID
    const context2 = new TestContext(testChainId2);
    await context2.setup({ skipGatewayInit: true });

    const tx2 = await context2.program.methods
      .initializeGateway(context2.chainId)
      .accounts({
        gateway: context2.gatewayPDA!,
        authority: context2.authority!.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([context2.authority!])
      .rpc();

    const cuUsed2 = await logTransactionWithCU(
      tx2,
      context2.connection,
      context2,
      "Chain2 Initialize",
      CU_LIMITS.EXPECTED_INITIALIZE
    );

    const gateway2 = await context2.getGateway();
    expect(gateway2.chainId.toString()).to.equal(testChainId2.toString());

    // Performance assertions for both chains
    expect(cuUsed1).to.be.lessThan(
      CU_LIMITS.EXPECTED_INITIALIZE * 1.5,
      `Chain1 initialization used ${cuUsed1} CU, expected ~${CU_LIMITS.EXPECTED_INITIALIZE} CU`
    );
    expect(cuUsed2).to.be.lessThan(
      CU_LIMITS.EXPECTED_INITIALIZE * 1.5,
      `Chain2 initialization used ${cuUsed2} CU, expected ~${CU_LIMITS.EXPECTED_INITIALIZE} CU`
    );

    logSuccess("Multiple chain IDs handled correctly");
    console.log(
      `  Chain ID 1: ${testChainId1.toString()} -> Gateway: ${context1.gatewayPDA!.toString()}`
    );
    console.log(
      `  Chain ID 2: ${testChainId2.toString()} -> Gateway: ${context2.gatewayPDA!.toString()}`
    );

    // Cleanup
    await context1.teardown();
    await context2.teardown();
  });

  it("[INIT-006] should set system enabled to true by default (circuit breaker off)", async () => {
    logTestHeader("[INIT-006] System Enabled Default State");
    context.showContext();
    logSubtest("Verifying default system enabled state");

    const tx = await context.program.methods
      .initializeGateway(context.chainId)
      .accounts({
        gateway: context.gatewayPDA!,
        authority: context.authority!.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([context.authority!])
      .rpc();

    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "System Enabled Check",
      CU_LIMITS.EXPECTED_INITIALIZE
    );
    context.metrics.transactionCount++;

    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.true;

    // Performance assertion
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_INITIALIZE * 1.5,
      `System enabled check used ${cuUsed} CU, expected ~${CU_LIMITS.EXPECTED_INITIALIZE} CU`
    );

    logSuccess("System enabled set to true by default");
  });

  it("[INIT-007] should store authority address correctly for admin functions", async () => {
    logTestHeader("[INIT-007] Authority Storage Verification");
    context.showContext();
    logSubtest("Verifying authority storage");

    const tx = await context.program.methods
      .initializeGateway(context.chainId)
      .accounts({
        gateway: context.gatewayPDA!,
        authority: context.authority!.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([context.authority!])
      .rpc();

    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "Authority Storage Check",
      CU_LIMITS.EXPECTED_INITIALIZE
    );
    context.metrics.transactionCount++;

    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.authority.toString()).to.equal(
      context.authority!.publicKey.toString()
    );

    // Performance assertion
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_INITIALIZE * 1.5,
      `Authority storage check used ${cuUsed} CU, expected ~${CU_LIMITS.EXPECTED_INITIALIZE} CU`
    );

    logSuccess("Authority stored correctly");
    console.log(`  Stored Authority: ${gatewayAccount.authority.toString()}`);
    console.log(
      `  Expected Authority: ${context.authority!.publicKey.toString()}`
    );
  });
});
