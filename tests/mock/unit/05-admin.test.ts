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
  TEST_ADDRESSES,
  logTestHeader,
  logSubtest,
  logSuccess,
  logTransactionWithCU,
  expectRevert,
} from "../../setup";

describe("Unit Tests - Admin Functions", () => {
  let context: TestContext;

  beforeEach(async () => {
    // Each test gets a unique chain ID to avoid PDA conflicts
    context = new TestContext();
    // Initialize gateway by default (system enabled)
    // Use silent setup to avoid premature logging
    await context.setup({ silent: true });
  });

  afterEach(async () => {
    await context.teardown();
  });

  it("[ADMIN-001] should enable system when called by authorized authority", async () => {
    logTestHeader("[ADMIN-001] Authorized System Enable");
    context.showContext();
    logSubtest("Testing system enable by authority");

    // First disable the system
    const disableTx = await context.setSystemEnabled(false);
    const cuUsedDisable = await logTransactionWithCU(
      disableTx,
      context.connection,
      context,
      "System Disable",
      CU_LIMITS.EXPECTED_ADMIN
    );
    context.metrics.transactionCount++;

    // Verify system is disabled
    let gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.false;
    logSuccess("System successfully disabled");

    // Re-enable the system
    const enableTx = await context.setSystemEnabled(true);
    const cuUsedEnable = await logTransactionWithCU(
      enableTx,
      context.connection,
      context,
      "System Enable",
      CU_LIMITS.EXPECTED_ADMIN
    );
    context.metrics.transactionCount++;

    // Verify system is enabled
    gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.true;

    // Performance checks
    expect(cuUsedDisable).to.be.lessThan(
      CU_LIMITS.EXPECTED_ADMIN * 1.5,
      `Disable used ${cuUsedDisable} CU, expected <${
        CU_LIMITS.EXPECTED_ADMIN * 1.5
      }`
    );
    expect(cuUsedEnable).to.be.lessThan(
      CU_LIMITS.EXPECTED_ADMIN * 1.5,
      `Enable used ${cuUsedEnable} CU, expected <${
        CU_LIMITS.EXPECTED_ADMIN * 1.5
      }`
    );

    logSuccess("System successfully enabled by authority");
    console.log(
      `  System Status: ${
        gatewayAccount.systemEnabled ? "ENABLED" : "DISABLED"
      }`
    );
  });

  it("[ADMIN-002] should disable system when called by authorized authority", async () => {
    logTestHeader("[ADMIN-002] Authorized System Disable");
    context.showContext();
    logSubtest("Testing system disable by authority");

    // Verify system starts enabled (from setup)
    let gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.true;
    logSuccess("System initially enabled");

    // Disable the system
    const disableTx = await context.setSystemEnabled(false);
    const cuUsed = await logTransactionWithCU(
      disableTx,
      context.connection,
      context,
      "System Disable",
      CU_LIMITS.EXPECTED_ADMIN
    );
    context.metrics.transactionCount++;

    // Verify system is disabled
    gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.false;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_ADMIN * 1.5,
      `Used ${cuUsed} CU, expected <${CU_LIMITS.EXPECTED_ADMIN * 1.5}`
    );

    logSuccess("System successfully disabled by authority");
    console.log(
      `  System Status: ${
        gatewayAccount.systemEnabled ? "ENABLED" : "DISABLED"
      }`
    );
  });

  it("[ADMIN-003] should reject unauthorized system enable/disable attempts", async () => {
    logTestHeader("[ADMIN-003] Unauthorized Access Rejection");
    context.showContext();
    logSubtest("Testing unauthorized access rejection");

    // Try to disable system with unauthorized user
    await expectRevert(
      context.setSystemEnabled(false, context.unauthorizedUser!),
      ERROR_CODES.UNAUTHORIZED_AUTHORITY
    );

    // Verify system remains enabled
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.true;

    logSuccess("Unauthorized access correctly rejected");
    console.log(
      `  System Status Unchanged: ${
        gatewayAccount.systemEnabled ? "ENABLED" : "DISABLED"
      }`
    );
  });

  it("[ADMIN-004] should handle multiple consecutive enable calls", async () => {
    logTestHeader("[ADMIN-004] Multiple Consecutive Enable Calls");
    context.showContext();
    logSubtest("Testing multiple consecutive enable calls");

    // Enable system multiple times (idempotent operation)
    const tx1 = await context.setSystemEnabled(true);
    const tx2 = await context.setSystemEnabled(true);
    const tx3 = await context.setSystemEnabled(true);

    const cuUsed = await logTransactionWithCU(
      tx3,
      context.connection,
      context,
      "Multiple Enables",
      CU_LIMITS.EXPECTED_ADMIN
    );
    context.metrics.transactionCount++;

    // Verify system remains enabled
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.true;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_ADMIN * 1.5,
      `Multiple enables used ${cuUsed} CU, expected <${
        CU_LIMITS.EXPECTED_ADMIN * 1.5
      }`
    );

    logSuccess("Multiple enable calls handled correctly");
    console.log(
      `  Final System Status: ${
        gatewayAccount.systemEnabled ? "ENABLED" : "DISABLED"
      }`
    );
  });

  it("[ADMIN-005] should handle multiple consecutive disable calls", async () => {
    logTestHeader("[ADMIN-005] Multiple Consecutive Disable Calls");
    context.showContext();
    logSubtest("Testing multiple consecutive disable calls");

    // Disable system multiple times (idempotent operation)
    const tx1 = await context.setSystemEnabled(false);
    const tx2 = await context.setSystemEnabled(false);
    const tx3 = await context.setSystemEnabled(false);

    const cuUsed = await logTransactionWithCU(
      tx3,
      context.connection,
      context,
      "Multiple Disables",
      CU_LIMITS.EXPECTED_ADMIN
    );
    context.metrics.transactionCount++;

    // Verify system remains disabled
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.false;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_ADMIN * 1.5,
      `Multiple disables used ${cuUsed} CU, expected <${
        CU_LIMITS.EXPECTED_ADMIN * 1.5
      }`
    );

    logSuccess("Multiple disable calls handled correctly");
    console.log(
      `  Final System Status: ${
        gatewayAccount.systemEnabled ? "ENABLED" : "DISABLED"
      }`
    );
  });

  it("[ADMIN-006] should prevent message sending when system is disabled", async () => {
    logTestHeader("[ADMIN-006] Message Sending Prevention When Disabled");
    context.showContext();
    logSubtest("Testing message sending prevention when disabled");

    // Disable the system
    await context.setSystemEnabled(false);

    // Verify system is disabled
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.false;
    logSuccess("System disabled");

    // Try to send message (should fail)
    const txId = new BN(Date.now());
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const destChainId = CHAIN_IDS.ETHEREUM_MAINNET;
    const chainData = Buffer.from("test-data", "utf8");

    await expectRevert(
      context.sendMessage(txId, recipient, destChainId, chainData, 1),
      ERROR_CODES.SYSTEM_DISABLED
    );

    logSuccess("Message sending correctly blocked when system disabled");
  });

  it("[ADMIN-007] should prevent message processing when system is disabled", async () => {
    logTestHeader("[ADMIN-007] Message Processing Prevention When Disabled");
    context.showContext();
    logSubtest("Testing message processing prevention when disabled");

    const txId = new BN(Date.now());
    const sourceChainId = new BN(Date.now() + 1000000);
    const destChainId = context.chainId;
    const sender = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const onChainData = Buffer.from("test-data", "utf8");
    const offChainData = Buffer.from("off-chain-test", "utf8");

    // TX1: Create TxId PDA while system is enabled
    await context.createTxPda(txId, sourceChainId);
    logSuccess("TX1: TxId PDA created while system enabled");

    // Disable the system
    await context.setSystemEnabled(false);

    // Verify system is disabled
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.false;
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

    logSuccess("Message processing correctly blocked when system disabled");
  });

  it("[ADMIN-008] should allow operations to resume when system is re-enabled", async () => {
    logTestHeader("[ADMIN-008] Operation Resumption After Re-enabling");
    context.showContext();
    logSubtest("Testing operation resumption after re-enabling");

    // Disable system
    await context.setSystemEnabled(false);
    logSuccess("System disabled");

    // Re-enable system
    await context.setSystemEnabled(true);
    logSuccess("System re-enabled");

    // Verify normal operations work again
    const txId = new BN(Date.now());
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const destChainId = CHAIN_IDS.ETHEREUM_MAINNET;
    const chainData = Buffer.from("test-data", "utf8");

    const sendTx = await context.sendMessage(
      txId,
      recipient,
      destChainId,
      chainData,
      1
    );
    const cuUsed = await logTransactionWithCU(
      sendTx,
      context.connection,
      context,
      "Resumed Send",
      CU_LIMITS.EXPECTED_SEND_MESSAGE
    );
    context.metrics.transactionCount++;

    // Verify gateway state is correct
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.true;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5,
      `Resumed send used ${cuUsed} CU, expected <${
        CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5
      }`
    );

    logSuccess("Operations resumed successfully after re-enabling");
  });

  it("[ADMIN-009] should work with different authority signers", async () => {
    logTestHeader("[ADMIN-009] Different Authority Signers Support");
    context.showContext();
    logSubtest("Testing admin operations with authority signer");

    // Use the authority directly (which is the same as context.authority)
    const tx = await context.setSystemEnabled(false, context.authority!);
    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "Authority Signer",
      CU_LIMITS.EXPECTED_ADMIN
    );
    context.metrics.transactionCount++;

    // Verify operation succeeded
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.false;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_ADMIN * 1.5,
      `Authority signer used ${cuUsed} CU, expected <${
        CU_LIMITS.EXPECTED_ADMIN * 1.5
      }`
    );

    logSuccess("Admin operation works with explicit authority signer");
  });

  it("[ADMIN-010] should maintain system state across multiple gateways", async () => {
    logTestHeader("[ADMIN-010] System State Independence Across Gateways");
    context.showContext();
    logSubtest("Testing system state independence across gateways");

    // Create a second context with different chain ID
    const context2 = new TestContext(new BN(Date.now() + 2000000));
    await context2.setup();

    // Disable first gateway
    await context.setSystemEnabled(false);

    // Verify first gateway is disabled
    const gateway1 = await context.getGateway();
    expect(gateway1.systemEnabled).to.be.false;

    // Verify second gateway is still enabled (independent state)
    const gateway2 = await context2.getGateway();
    expect(gateway2.systemEnabled).to.be.true;

    logSuccess("System states are independent across different gateways");
    console.log(
      `  Gateway 1 (Chain ${context.chainId}): ${
        gateway1.systemEnabled ? "ENABLED" : "DISABLED"
      }`
    );
    console.log(
      `  Gateway 2 (Chain ${context2.chainId}): ${
        gateway2.systemEnabled ? "ENABLED" : "DISABLED"
      }`
    );

    // Cleanup
    await context2.teardown();
  });

  it("[ADMIN-011] should validate authority ownership correctly", async () => {
    logTestHeader("[ADMIN-011] Authority Ownership Validation");
    context.showContext();
    logSubtest("Testing authority ownership validation");

    // Create a completely new keypair (not related to gateway)
    const randomKeypair = anchor.web3.Keypair.generate();

    // Airdrop some SOL to the random keypair so transaction can be attempted
    const airdropTx = await context.connection.requestAirdrop(
      randomKeypair.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await context.connection.confirmTransaction(airdropTx);

    // Try to use random keypair as authority (should fail)
    await expectRevert(
      context.setSystemEnabled(false, randomKeypair),
      ERROR_CODES.UNAUTHORIZED_AUTHORITY
    );

    // Verify system state unchanged
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.true;

    logSuccess("Authority ownership validation working correctly");
    console.log(`  Gateway Authority: ${gatewayAccount.authority.toString()}`);
    console.log(`  Random Keypair: ${randomKeypair.publicKey.toString()}`);
  });

  it("[ADMIN-012] should handle rapid enable/disable toggles", async () => {
    logTestHeader("[ADMIN-012] Rapid System State Toggles");
    context.showContext();
    logSubtest("Testing rapid system state toggles");

    const states = [false, true, false, true, false, true];
    let lastState = true; // Starting state from setup

    for (let i = 0; i < states.length; i++) {
      const targetState = states[i];
      const tx = await context.setSystemEnabled(targetState);

      // Verify state changed
      const gatewayAccount = await context.getGateway();
      expect(gatewayAccount.systemEnabled).to.equal(targetState);

      console.log(
        `  Toggle ${i + 1}: ${lastState ? "ENABLED" : "DISABLED"} -> ${
          targetState ? "ENABLED" : "DISABLED"
        }`
      );
      lastState = targetState;
    }

    logSuccess("Rapid state toggles handled correctly");

    // Final verification
    const finalGateway = await context.getGateway();
    expect(finalGateway.systemEnabled).to.equal(states[states.length - 1]);
  });

  it("[ADMIN-013] should prevent admin operations on non-existent gateway", async () => {
    logTestHeader("[ADMIN-013] Non-Existent Gateway Admin Operations");
    context.showContext();
    logSubtest("Testing admin operations on non-existent gateway");

    // Create a context but don't initialize the gateway
    const contextNoGateway = new TestContext();
    await contextNoGateway.setup({ skipGatewayInit: true });

    // Try to set system enabled on non-existent gateway
    await expectRevert(
      contextNoGateway.setSystemEnabled(false),
      "AccountNotInitialized" // Gateway PDA doesn't exist
    );

    logSuccess("Admin operations correctly reject non-existent gateways");

    // Cleanup
    await contextNoGateway.teardown();
  });

  it("[ADMIN-014] should maintain correct authority after system state changes", async () => {
    logTestHeader("[ADMIN-014] Authority Preservation Across State Changes");
    context.showContext();
    logSubtest("Testing authority preservation across state changes");

    const originalAuthority = (await context.getGateway()).authority.toString();

    // Toggle system state multiple times
    await context.setSystemEnabled(false);
    await context.setSystemEnabled(true);
    await context.setSystemEnabled(false);
    await context.setSystemEnabled(true);

    // Verify authority hasn't changed
    const finalGateway = await context.getGateway();
    expect(finalGateway.authority.toString()).to.equal(originalAuthority);

    logSuccess("Authority preserved across state changes");
    console.log(`  Authority: ${finalGateway.authority.toString()}`);
  });
});
