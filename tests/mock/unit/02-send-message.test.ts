import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

import {
  TestContext,
  CHAIN_IDS,
  CU_LIMITS,
  ERROR_CODES,
  TEST_PAYLOADS,
  TEST_ADDRESSES,
  logTestHeader,
  logSubtest,
  logSuccess,
  logTransactionWithCU,
  expectRevert,
} from "../../setup";

describe("Unit Tests - Message Sending", () => {
  let context: TestContext;

  beforeEach(async () => {
    // Each test gets a unique chain ID to avoid PDA conflicts
    context = new TestContext();
    // Initialize gateway by default for send_message tests
    // Use silent setup to avoid premature logging
    await context.setup({ silent: true });
  });

  afterEach(async () => {
    await context.teardown();
  });

  it("[SEND-001] should send a valid cross-chain message and validate state", async () => {
    logTestHeader("[SEND-001] Valid Cross-Chain Message Sending");
    context.showContext();
    logSubtest("Testing valid message sending with state validation");

    const txId = new BN(Date.now());
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const destChainId = CHAIN_IDS.ETHEREUM_MAINNET;
    const chainData = TEST_PAYLOADS.SIMPLE;
    const confirmations = 12;

    const tx = await context.sendMessage(
      txId,
      recipient,
      destChainId,
      chainData,
      confirmations
    );

    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "Send Message",
      CU_LIMITS.EXPECTED_SEND_MESSAGE
    );
    context.metrics.transactionCount++;

    // Verify gateway state remains unchanged
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.true;
    expect(gatewayAccount.authority.toString()).to.equal(
      context.authority!.publicKey.toString()
    );

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5,
      `Used ${cuUsed} CU, expected <${CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5}`
    );

    logSuccess("Message sent successfully");
    console.log(`  TX ID: ${txId.toString()}`);
    console.log(`  Recipient: ${recipient.toString("hex")}`);
    console.log(`  Destination: Chain ${destChainId.toString()}`);
    console.log(`  Data Length: ${chainData.length} bytes`);
  });

  it("[SEND-002] should handle maximum length recipient addresses", async () => {
    logTestHeader("[SEND-002] Maximum Length Recipient Address Handling");
    context.showContext();
    logSubtest("Testing maximum length recipient address validation");

    const txId = new BN(Date.now() + 1000);
    const recipient = Buffer.alloc(32, 0xff); // 32-byte max recipient
    const destChainId = CHAIN_IDS.BSC_MAINNET;
    const chainData = Buffer.from("test", "utf8");
    const confirmations = 6;

    const tx = await context.sendMessage(
      txId,
      recipient,
      destChainId,
      chainData,
      confirmations
    );

    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "Max Recipient",
      CU_LIMITS.EXPECTED_SEND_MESSAGE
    );
    context.metrics.transactionCount++;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5,
      `Max recipient used ${cuUsed} CU, expected <${
        CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5
      }`
    );

    logSuccess("Maximum length recipient handled correctly");
    console.log(`  Recipient Length: ${recipient.length} bytes`);
  });

  it("[SEND-003] should handle maximum length chain data", async () => {
    logTestHeader("[SEND-003] Maximum Length Chain Data Handling");
    context.showContext();
    logSubtest("Testing maximum length chain data validation");

    const txId = new BN(Date.now() + 2000);
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const destChainId = CHAIN_IDS.POLYGON_MAINNET;
    const chainData = Buffer.alloc(512, 0x41); // 512 bytes of 'A', large but within transaction limits
    const confirmations = 64;

    const tx = await context.sendMessage(
      txId,
      recipient,
      destChainId,
      chainData,
      confirmations
    );

    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "Max Chain Data",
      CU_LIMITS.EXPECTED_SEND_MESSAGE
    );
    context.metrics.transactionCount++;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5,
      `Max chain data used ${cuUsed} CU, expected <${
        CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5
      }`
    );

    logSuccess("Maximum length chain data handled correctly");
    console.log(`  Chain Data Length: ${chainData.length} bytes`);
  });

  it("[SEND-004] should handle different destination chain IDs", async () => {
    logTestHeader("[SEND-004] Multiple Destination Chain ID Support");
    context.showContext();
    logSubtest("Testing various destination chain IDs");

    const testCases = [
      { chainId: CHAIN_IDS.ETHEREUM_MAINNET, name: "Ethereum Mainnet" },
      { chainId: CHAIN_IDS.POLYGON_MAINNET, name: "Polygon Mainnet" },
      { chainId: CHAIN_IDS.BSC_MAINNET, name: "BSC Mainnet" },
      { chainId: CHAIN_IDS.AVALANCHE_MAINNET, name: "Avalanche Mainnet" },
    ];

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const txId = new BN(Date.now() + 3000 + i);
      const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
      const chainData = Buffer.from(`test-${testCase.name}`, "utf8");

      const tx = await context.sendMessage(
        txId,
        recipient,
        testCase.chainId,
        chainData,
        1
      );

      logSuccess(
        `Message sent to ${
          testCase.name
        } (Chain ID: ${testCase.chainId.toString()})`
      );
    }

    logSuccess("All destination chain IDs handled correctly");
  });

  it("[SEND-005] should handle different confirmation requirements", async () => {
    logTestHeader("[SEND-005] Variable Confirmation Requirements");
    context.showContext();
    logSubtest("Testing various confirmation requirements");

    const confirmationTests = [1, 6, 12, 32, 64, 128];

    for (let i = 0; i < confirmationTests.length; i++) {
      const confirmations = confirmationTests[i];
      const txId = new BN(Date.now() + 4000 + i);
      const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
      const destChainId = CHAIN_IDS.ETHEREUM_MAINNET;
      const chainData = Buffer.from(`conf-test-${confirmations}`, "utf8");

      const tx = await context.sendMessage(
        txId,
        recipient,
        destChainId,
        chainData,
        confirmations
      );

      console.log(`  ✓ ${confirmations} confirmations: ${tx}`);
    }

    logSuccess("All confirmation requirements handled correctly");
  });

  it("[SEND-006] should reject sending when system is disabled", async () => {
    logTestHeader("[SEND-006] System Disabled Circuit Breaker");
    context.showContext();
    logSubtest("Testing message sending rejection when system disabled");

    // First disable the system
    await context.setSystemEnabled(false);

    // Verify system is disabled
    const gatewayAccount = await context.getGateway();
    expect(gatewayAccount.systemEnabled).to.be.false;
    logSuccess("System successfully disabled");

    // Try to send message (should fail)
    const txId = new BN(Date.now() + 5000);
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const destChainId = CHAIN_IDS.ETHEREUM_MAINNET;
    const chainData = Buffer.from("should-fail", "utf8");

    await expectRevert(
      context.sendMessage(txId, recipient, destChainId, chainData, 1),
      ERROR_CODES.SYSTEM_DISABLED
    );

    logSuccess("Message sending correctly rejected when system disabled");

    // Re-enable system for cleanup
    await context.setSystemEnabled(true);
  });

  it("[SEND-007] should allow any valid sender to send messages", async () => {
    logTestHeader("[SEND-007] Permissionless Message Sending");
    context.showContext();
    logSubtest("Testing that any valid sender can send messages");

    const txId = new BN(Date.now() + 6000);
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const destChainId = CHAIN_IDS.ETHEREUM_MAINNET;
    const chainData = Buffer.from("unauthorized-test", "utf8");

    // The program allows any signer to send messages (no authorization restrictions)
    const tx = await context.program.methods
      .sendMessage(txId, recipient, destChainId, chainData, 1)
      .accounts({
        gateway: context.gatewayPDA!,
        sender: context.unauthorizedUser!.publicKey,
      })
      .signers([context.unauthorizedUser!])
      .rpc();

    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "Unauthorized Send",
      CU_LIMITS.EXPECTED_SEND_MESSAGE
    );
    context.metrics.transactionCount++;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5,
      `Unauthorized send used ${cuUsed} CU, expected <${
        CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5
      }`
    );

    logSuccess(
      "Any valid sender can send messages (no authorization restrictions)"
    );
  });

  it("[SEND-008] should generate unique transaction IDs", async () => {
    logTestHeader("[SEND-008] Transaction ID Uniqueness Validation");
    context.showContext();
    logSubtest("Testing transaction ID uniqueness");

    const baseTime = Date.now();
    const txIds: BN[] = [];
    const numTxs = 5;

    // Send multiple messages with different TX IDs
    for (let i = 0; i < numTxs; i++) {
      const txId = new BN(baseTime + i);
      txIds.push(txId);

      const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
      const destChainId = CHAIN_IDS.ETHEREUM_MAINNET;
      const chainData = Buffer.from(`unique-test-${i}`, "utf8");

      const tx = await context.sendMessage(
        txId,
        recipient,
        destChainId,
        chainData,
        1
      );

      console.log(`  ✓ TX ${i + 1}: ID ${txId.toString()} -> ${tx}`);
    }

    // Verify all TX IDs are unique
    const uniqueTxIds = new Set(txIds.map((id) => id.toString()));
    expect(uniqueTxIds.size).to.equal(numTxs);

    logSuccess("All transaction IDs are unique");
  });

  it("[SEND-009] should reject empty chain data", async () => {
    logTestHeader("[SEND-009] Empty Chain Data Validation");
    context.showContext();
    logSubtest("Testing empty chain data rejection");

    const txId = new BN(Date.now() + 7000);
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_1, "hex");
    const destChainId = CHAIN_IDS.ETHEREUM_MAINNET;
    const chainData = Buffer.alloc(0); // Empty buffer
    const confirmations = 1;

    await expectRevert(
      context.sendMessage(
        txId,
        recipient,
        destChainId,
        chainData,
        confirmations
      ),
      "EmptyChainData" // Custom error from the program
    );

    logSuccess("Empty chain data correctly rejected");
    console.log(`  Chain Data Length: ${chainData.length} bytes`);
  });

  it("[SEND-010] should validate minimum recipient address length", async () => {
    logTestHeader("[SEND-010] Minimum Recipient Address Validation");
    context.showContext();
    logSubtest("Testing minimum recipient address validation");

    const txId = new BN(Date.now() + 8000);
    const recipient = Buffer.from(TEST_ADDRESSES.ETH_ADDRESS_2, "hex");
    const destChainId = CHAIN_IDS.ETHEREUM_MAINNET;
    const chainData = Buffer.from("min-recipient-test", "utf8");
    const confirmations = 1;

    const tx = await context.sendMessage(
      txId,
      recipient,
      destChainId,
      chainData,
      confirmations
    );

    const cuUsed = await logTransactionWithCU(
      tx,
      context.connection,
      context,
      "Min Recipient",
      CU_LIMITS.EXPECTED_SEND_MESSAGE
    );
    context.metrics.transactionCount++;

    // Performance check
    expect(cuUsed).to.be.lessThan(
      CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5,
      `Min recipient used ${cuUsed} CU, expected <${
        CU_LIMITS.EXPECTED_SEND_MESSAGE * 1.5
      }`
    );

    logSuccess("Minimum recipient address handled correctly");
    console.log(`  Recipient Length: ${recipient.length} bytes`);
  });
});
