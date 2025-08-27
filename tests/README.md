# Via Labs Solana Test Suite

## Overview

Comprehensive test suite for the Via Labs V4 Message Gateway on Solana, featuring unit, integration, and end-to-end tests with two-transaction replay protection validation.

## Test Structure

```
tests/
├── unit/                    # Individual instruction tests
│   ├── 01-initialize.test.ts      # Gateway initialization
│   ├── 02-send-message.test.ts    # Message sending
│   ├── 03-create-tx-pda.test.ts   # TX1: PDA creation
│   ├── 04-process-message.test.ts # TX2: Message processing
│   └── 05-admin.test.ts           # Admin controls
│
├── integration/             # Multi-instruction flows
│   ├── 01-two-transaction-flow.test.ts  # Complete message flow
│   ├── 02-performance-tracking.test.ts  # CU measurements
│   └── 03-error-recovery.test.ts        # Error handling
│
├── e2e/                     # End-to-end scenarios
│   ├── 01-cross-chain-flows.test.ts       # Cross-chain messaging
│   ├── 02-multi-gateway-interactions.test.ts # Multiple gateways
│   ├── 03-load-testing-benchmarks.test.ts   # Performance tests
│   ├── 04-security-scenarios.test.ts        # Security validation
│   └── 05-real-world-data-flows.test.ts     # Production scenarios
│
└── setup/                   # Test utilities
    ├── index.ts            # Main exports
    ├── context.ts          # TestContext class
    ├── constants.ts        # Test constants
    ├── helpers.ts          # Utility functions
    └── fixtures.ts         # Test data generators
```

## Quick Start

### Prerequisites

1. Install dependencies:
```bash
yarn install
```

2. Start local Solana validator:
```bash
solana-test-validator
```

3. Build the program:
```bash
anchor build
```

### Running Tests

```bash
# Run all tests
anchor test

# Run specific test category
yarn test:unit
yarn test:integration
yarn test:e2e

# Run individual test file
yarn run ts-mocha -p ./tsconfig.json tests/unit/01-initialize.test.ts

# Run tests with coverage
yarn test:coverage
```

## Test Categories Explained

### Unit Tests
Test individual instructions in isolation:
- **Initialize**: Gateway setup validation
- **Send Message**: Outbound message creation
- **Create TX PDA**: Replay protection (TX1)
- **Process Message**: Inbound processing (TX2)
- **Admin**: System control operations

### Integration Tests
Test multi-step workflows:
- **Two-Transaction Flow**: Complete message lifecycle
- **Performance Tracking**: Compute unit optimization
- **Error Recovery**: Failure handling and rollback

### E2E Tests
Test production scenarios:
- **Cross-Chain Flows**: Ethereum ↔ Solana messaging
- **Multi-Gateway**: Multiple chain interactions
- **Load Testing**: High-volume benchmarks
- **Security**: Attack vector validation
- **Real World**: Production data patterns

## Key Components

### TestContext Class

Central test orchestrator managing:
```typescript
class TestContext {
  // Core components
  program: Program<MessageGatewayV4>
  connection: Connection
  
  // Test accounts
  authority: Keypair        // Admin account
  relayer: Keypair         // Message relayer
  unauthorizedUser: Keypair // For security tests
  
  // PDAs
  gatewayPDA: PublicKey    // Gateway state account
  
  // Metrics
  transactionCount: number
  totalComputeUnits: number
}
```

### Test Lifecycle

```typescript
describe("Test Suite", () => {
  let context: TestContext;
  
  beforeEach(async () => {
    // 1. Create fresh context
    context = new TestContext();
    
    // 2. Setup accounts & fund
    await context.setup();
    
    // 3. Initialize gateway (optional)
    await context.initializeGateway();
  });
  
  it("test case", async () => {
    // Test implementation
  });
  
  afterEach(async () => {
    // Cleanup & metrics
    await context.teardown();
  });
});
```

## Common Test Patterns

### 1. Success Path Testing
```typescript
it("should process valid message", async () => {
  // Setup
  const txId = new BN(1000);
  
  // Execute
  await context.createTxPda(txId, sourceChainId);
  await context.processMessage(txId, ...params);
  
  // Verify
  const exists = await context.txIdPDAExists(sourceChainId, txId);
  expect(exists).to.be.false; // PDA closed after processing
});
```

### 2. Error Validation
```typescript
it("should reject unauthorized access", async () => {
  await expectRevert(
    context.setSystemEnabled(false, context.unauthorizedUser),
    ERROR_CODES.UNAUTHORIZED
  );
});
```

### 3. State Verification
```typescript
it("should update gateway state", async () => {
  // Before
  const before = await context.getGateway();
  expect(before.systemEnabled).to.be.true;
  
  // Action
  await context.setSystemEnabled(false);
  
  // After
  const after = await context.getGateway();
  expect(after.systemEnabled).to.be.false;
});
```

## Test Utilities

### PDA Derivation
```typescript
// Gateway PDA
const [gatewayPDA, bump] = deriveGatewayPDA(programId, chainId);

// TxId PDA (replay protection)
const [txIdPDA] = deriveTxIdPDA(programId, sourceChainId, txId);

// Counter PDA (sequence tracking)
const [counterPDA] = deriveCounterPDA(programId, sourceChainId);
```

### Test Data Generators
```typescript
// Generate test message
const message = generateTestMessage({
  txId: new BN(1000),
  sourceChainId: CHAIN_IDS.ETHEREUM,
  destChainId: CHAIN_IDS.SOLANA,
  sender: generateEthereumAddress(),
  recipient: generateSolanaAddress()
});
```

### Assertion Helpers
```typescript
// Expect transaction to revert
await expectRevert(promise, "Expected error message");

// Check account exists
const exists = await accountExists(connection, pubkey);

// Measure compute units
const cu = await measureComputeUnits(connection, instruction, payer);
```

## Configuration

### Test Constants (`setup/constants.ts`)
```typescript
// Chain IDs
CHAIN_IDS.SOLANA_LOCALNET = 1
CHAIN_IDS.ETHEREUM_MAINNET = 2

// Test Config
TEST_CONFIG.AIRDROP_AMOUNT = 10 SOL
TEST_CONFIG.DEFAULT_CONFIRMATIONS = 1

// Compute Unit Limits
CU_LIMITS.MAX_PER_TRANSACTION = 200,000
CU_LIMITS.EXPECTED_PROCESS_MESSAGE = 50,000
```

## Performance Metrics

Tests track and report:
- Transaction count
- Total compute units used
- Average CU per transaction
- Execution time

Example output:
```
📊 Test Metrics:
  Total transactions: 12
  Total compute units: 450,000
  Avg CU per transaction: 37,500
  Elapsed time: 3,245ms
```

## Troubleshooting

### Common Issues

1. **"ANCHOR_PROVIDER_URL is not defined"**
   - Start local validator: `solana-test-validator`
   - Set environment: `export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899`

2. **"Account does not exist"**
   - Ensure program is deployed: `anchor deploy`
   - Check program ID matches in `Anchor.toml`

3. **"Transaction simulation failed"**
   - Check account balances: `solana balance <pubkey>`
   - Verify PDA derivation matches on-chain

4. **"Timeout exceeded"**
   - Increase timeout in test command: `-t 1000000`
   - Check validator is running and responsive

### Debug Tips

```bash
# View transaction logs
solana logs | grep "Program 4hjw"

# Check account state
solana account <pubkey>

# Monitor validator
solana-test-validator --log
```

## Best Practices

1. **Test Isolation**: Each test uses unique chain IDs to prevent conflicts
2. **Cleanup**: Always call `context.teardown()` in `afterEach`
3. **Assertions**: Use descriptive error messages for failed assertions
4. **Metrics**: Track compute units for performance optimization
5. **Security**: Test both success and failure paths

## Contributing

1. Follow existing test patterns
2. Add comprehensive assertions
3. Document complex test scenarios
4. Include performance metrics
5. Test error conditions

## CI/CD Integration

```yaml
# GitHub Actions example
- name: Run tests
  run: |
    anchor test --skip-local-validator
  env:
    ANCHOR_PROVIDER_URL: http://127.0.0.1:8899
```

## License

MIT