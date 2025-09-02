# Via Labs V4 Solana Security Architecture

## Overview

The Via Labs V4 Solana implementation features a production-grade **Three-Layer Signature Validation System** that ensures enterprise-level security for cross-chain message passing. This document provides a comprehensive technical overview of the security architecture, implementation details, and operational procedures.

## 🔐 Three-Layer Security Model

### Architecture Overview

The security system implements three distinct validation layers, each serving a specific role in the message authentication process:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   VIA LAYER     │    │   CHAIN LAYER   │    │ PROJECT LAYER   │
│                 │    │                 │    │                 │
│ Via Labs Core   │    │ Source Chain    │    │ Application     │
│ Signers         │    │ Validators      │    │ Specific        │
│                 │    │                 │    │ Signers         │
│ Threshold: 2/3  │    │ Threshold: 1/2  │    │ Threshold: 1/1  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │   MESSAGE VALIDATION     │
                    │                          │
                    │ All layers must meet     │
                    │ threshold requirements   │
                    │ for message processing   │
                    └──────────────────────────┘
```

### Layer Specifications

#### 1. VIA Layer (Highest Authority)
- **Purpose**: Via Labs core protocol validation
- **Registry Type**: `SignerRegistryType::VIA`
- **Authority**: Via Labs protocol team
- **Typical Threshold**: 2 out of 3 signatures required
- **Scope**: Global protocol security decisions

#### 2. Chain Layer (Network Security)
- **Purpose**: Source blockchain validator authentication
- **Registry Type**: `SignerRegistryType::Chain`
- **Authority**: Chain-specific validator set
- **Typical Threshold**: 1 out of 2 signatures required
- **Scope**: Network consensus validation

#### 3. Project Layer (Application Security)
- **Purpose**: Application-specific authorization
- **Registry Type**: `SignerRegistryType::Project`
- **Authority**: Individual project teams
- **Typical Threshold**: 1 out of 1 signature required
- **Scope**: Application business logic validation

## 🏗️ Technical Implementation

### Core Components

#### 1. SignerRegistry Account Structure

```rust
#[account]
pub struct SignerRegistry {
    pub registry_type: SignerRegistryType,    // VIA, Chain, or Project
    pub authority: Pubkey,                    // Who can modify this registry
    pub signers: Vec<Pubkey>,                 // Authorized signer public keys
    pub required_signatures: u8,             // Minimum signatures required
    pub chain_id: u64,                       // Associated chain identifier
    pub enabled: bool,                       // Emergency disable flag
    pub bump: u8,                            // PDA bump seed
}
```

#### 2. Message Signature Structure

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MessageSignature {
    pub signature: [u8; 64],                 // Ed25519 signature bytes
    pub signer: Pubkey,                      // Signer public key
    pub layer: SignerLayer,                  // VIA, Chain, or Project
}
```

#### 3. PDA Seed Structures

**Signer Registry PDAs:**
```rust
// VIA Registry: ["signer_registry", 0, chain_id_bytes]
// Chain Registry: ["signer_registry", 1, source_chain_id_bytes]  
// Project Registry: ["signer_registry", 2, project_chain_id_bytes]
```

**Gateway PDA:**
```rust
// Gateway: ["gateway", chain_id_bytes]
```

### Cryptographic Security

#### Ed25519 Signature Verification

The system uses Solana's native Ed25519 program for cryptographic verification:

```rust
pub fn verify_ed25519_signature(
    signature: &[u8; 64],
    signer: &Pubkey,
    message_hash: &[u8; 32],
    ix_sysvar_account: &AccountInfo,
) -> Result<bool>
```

**Process:**
1. Checks for corresponding Ed25519 instruction in the same transaction
2. Validates signature format and parameters
3. Confirms cryptographic authenticity
4. Prevents signature replay attacks

#### Cross-Chain Message Hashing

Messages are hashed using Keccak256 for Ethereum compatibility:

```rust
pub fn create_cross_chain_hash(
    tx_id: u128,
    source_chain_id: u64,
    dest_chain_id: u64,
    sender: &[u8],
    recipient: &[u8],
    on_chain_data: &[u8],
    off_chain_data: &[u8],
) -> Result<[u8; 32]>
```

**Encoding Format:**
```
┌─────────────────────────────────────────────────────────────┐
│ u128 tx_id (16 bytes, little endian)                       │
├─────────────────────────────────────────────────────────────┤
│ u64 source_chain_id (8 bytes, little endian)              │
├─────────────────────────────────────────────────────────────┤
│ u64 dest_chain_id (8 bytes, little endian)                │
├─────────────────────────────────────────────────────────────┤
│ u32 sender_length + sender_bytes (length-prefixed)         │
├─────────────────────────────────────────────────────────────┤
│ u32 recipient_length + recipient_bytes (length-prefixed)   │
├─────────────────────────────────────────────────────────────┤
│ u32 on_chain_length + on_chain_bytes (length-prefixed)     │
├─────────────────────────────────────────────────────────────┤
│ u32 off_chain_length + off_chain_bytes (length-prefixed)   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                     Keccak256 Hash
                      [u8; 32]
```

## 🔄 Message Processing Flow

### Two-Transaction Security Pattern

The system implements atomic replay protection using a two-transaction pattern:

#### TX1: `create_tx_pda`
```rust
pub fn create_tx_pda(
    ctx: Context<CreateTxPda>,
    tx_id: u128,
    source_chain_id: u64,
    dest_chain_id: u64,
    sender: Vec<u8>,
    recipient: Vec<u8>,
    on_chain_data: Vec<u8>,
    off_chain_data: Vec<u8>,
    signatures: Vec<MessageSignature>,
) -> Result<()>
```

**Security Validations:**
1. ✅ **Input Size Validation**: DOS protection
2. ✅ **Message Hash Generation**: Creates cryptographic hash
3. ✅ **Basic Signature Verification**: At least one valid Ed25519 signature
4. ✅ **TxId PDA Creation**: Prevents replay attempts (can only be created once)

#### TX2: `process_message`
```rust
pub fn process_message(
    ctx: Context<ProcessMessage>,
    tx_id: u128,
    source_chain_id: u64,
    dest_chain_id: u64,
    sender: Vec<u8>,
    recipient: Vec<u8>,
    on_chain_data: Vec<u8>,
    off_chain_data: Vec<u8>,
    signatures: Vec<MessageSignature>,
) -> Result<()>
```

**Security Validations:**
1. ✅ **System Enable Check**: Circuit breaker protection
2. ✅ **Destination Chain Validation**: Ensures proper routing
3. ✅ **TxId PDA Verification**: Confirms TX1 succeeded
4. ✅ **Message Hash Recreation**: Ensures data integrity
5. ✅ **Three-Layer Signature Validation**: Full security model
6. ✅ **Atomic PDA Closure**: Prevents replay, reclaims rent

### Signature Validation Process

```rust
pub fn validate_three_layer_signatures(
    signatures: &[MessageSignature],
    message_hash: &[u8; 32],
    via_registry: &SignerRegistry,
    chain_registry: &SignerRegistry,
    project_registry: Option<&SignerRegistry>,
    ix_sysvar_account: &AccountInfo,
) -> Result<ValidationResult>
```

**Validation Steps:**
1. **Input Validation**: Signature count limits, registry status
2. **Duplicate Prevention**: No signer reuse within a message
3. **Cryptographic Verification**: Ed25519 signature validation
4. **Authorization Check**: Signer must be in appropriate registry
5. **Threshold Validation**: Each layer must meet minimum signatures
6. **Result Aggregation**: Count valid signatures per layer

## 🛡️ Security Features

### DOS Protection

#### Input Size Limits
```rust
pub const MAX_RECIPIENT_SIZE: usize = 64;
pub const MAX_SENDER_SIZE: usize = 64;
pub const MAX_ON_CHAIN_DATA_SIZE: usize = 1024;
pub const MAX_OFF_CHAIN_DATA_SIZE: usize = 1024;
pub const MAX_SIGNATURES_PER_MESSAGE: usize = 8;
pub const MIN_SIGNATURES_REQUIRED: usize = 2;
```

#### Compute Unit Optimization
- **Signature Verification**: ~36K CU per signature set
- **Message Processing**: ~71K CU total instruction execution
- **Safety Margin**: Well under 200K Solana transaction limit

### Replay Attack Prevention

#### Atomic PDA Pattern
1. **TX1**: Creates unique TxId PDA (can only happen once per tx_id)
2. **TX2**: Processes message and atomically closes PDA
3. **Rent Reclamation**: ~0.002 SOL returned to relayer
4. **Replay Impossibility**: Closed PDA cannot be recreated

#### Out-of-Order Support
- Messages can be processed in any order
- Counter PDA tracks highest `tx_id` seen per source chain
- No dependency on sequential processing

### Authority Controls

#### Registry Management
- **Initialize**: Create new signer registries with initial configuration
- **Update Signers**: Replace entire signer set and threshold
- **Add/Remove**: Modify individual signers
- **Update Threshold**: Change signature requirements
- **Enable/Disable**: Emergency registry controls

#### Gateway Administration
- **System Enable/Disable**: Circuit breaker for emergency stops
- **Authority Transfer**: Change gateway authority (if needed)

## 📊 Error Handling

### Comprehensive Error Codes

#### Signature Validation Errors
```rust
#[error_code]
pub enum GatewayError {
    InvalidSignature,                    // Cryptographic verification failed
    InsufficientSignatures,             // Too few signatures provided
    UnauthorizedSigner,                 // Signer not in registry
    InvalidMessageHash,                 // Hash validation failed
    InsufficientVIASignatures,          // VIA threshold not met
    InsufficientChainSignatures,        // Chain threshold not met
    InsufficientProjectSignatures,      // Project threshold not met
    DuplicateSigner,                    // Signer used multiple times
    TooManySignatures,                  // Exceeded maximum signatures
    TooFewSignatures,                   // Below minimum requirement
    // ... additional security errors
}
```

### Error Recovery Patterns

#### Failed TX1 Recovery
- TxId PDA not created → Can retry TX1 with corrected parameters
- Invalid signatures → Fix signatures and retry
- DOS limits exceeded → Reduce data size and retry

#### Failed TX2 Recovery
- Missing TX1 → Must complete TX1 first
- Insufficient signatures → Add more signatures to meet thresholds
- Registry disabled → Contact registry authority to re-enable

## 🧪 Testing Framework

### Security Test Coverage

#### Unit Tests
- **Hash Generation**: Consistency and collision resistance
- **Signature Verification**: Valid/invalid signature handling
- **Registry Management**: CRUD operations and authority validation
- **Threshold Logic**: Boundary conditions and edge cases

#### Integration Tests
- **End-to-End Flow**: Complete TX1 → TX2 message processing
- **Multi-Layer Validation**: All three layers working together
- **Error Scenarios**: Invalid signatures, insufficient thresholds
- **Performance Tests**: Compute unit usage validation

#### Security Scenarios
- **Replay Attack Prevention**: Duplicate transaction attempts
- **Authorization Bypass**: Unauthorized signer attempts
- **DOS Resistance**: Large data and signature count limits
- **Registry Tampering**: Unauthorized registry modifications

### Example Test Structure

```typescript
describe("Security Validation Tests", () => {
  describe("Cross-Chain Message Hash Generation", () => {
    it("should generate consistent hashes", async () => {
      // Test deterministic hash generation
    });
    
    it("should produce different hashes for different inputs", async () => {
      // Test hash collision resistance
    });
  });
  
  describe("Three-Layer Signature Validation Integration", () => {
    it("should successfully process message with valid signatures", async () => {
      // Test complete validation flow
    });
    
    it("should reject message with insufficient signatures", async () => {
      // Test threshold enforcement
    });
  });
});
```

## 🚀 Production Deployment

### Deployment Checklist

#### Pre-Deployment
- [ ] **Registry Initialization**: Set up all three signer registries
- [ ] **Signer Key Management**: Secure storage of Ed25519 private keys
- [ ] **Threshold Configuration**: Appropriate signature requirements
- [ ] **Authority Setup**: Gateway authority key management
- [ ] **Testing Complete**: Full test suite passes on target network

#### Post-Deployment
- [ ] **Monitoring Setup**: Transaction success/failure tracking
- [ ] **Registry Backup**: Signer configurations documented
- [ ] **Emergency Procedures**: Registry disable/enable processes
- [ ] **Performance Monitoring**: Compute unit usage tracking
- [ ] **Security Audit**: External security review completed

### Operational Procedures

#### Signer Rotation
1. **Add New Signers**: Use `add_signer` instruction
2. **Test New Configuration**: Verify with test messages
3. **Remove Old Signers**: Use `remove_signer` instruction
4. **Update Documentation**: Record configuration changes

#### Emergency Response
1. **Disable System**: Use `set_system_enabled(false)`
2. **Disable Specific Registry**: Use `set_registry_enabled(false)`
3. **Investigate Issue**: Analyze transaction logs and errors
4. **Fix and Re-enable**: Address issue and restore service

## 🔍 Monitoring & Analytics

### Key Metrics

#### Security Metrics
- **Signature Validation Success Rate**: >99.5% target
- **Invalid Signature Attempts**: Monitor for attack patterns
- **Registry Modifications**: Track administrative changes
- **System Disable Events**: Emergency activation frequency

#### Performance Metrics
- **Message Processing Time**: <2 seconds average
- **Compute Unit Usage**: Monitor for efficiency
- **Transaction Success Rate**: >99.5% target
- **Rent Reclamation**: Verify PDA closure efficiency

#### Operational Metrics
- **Signer Registry Status**: Active/inactive registries
- **Threshold Compliance**: Signature requirements met
- **Cross-Chain Volume**: Message traffic by source chain
- **Error Rate by Type**: Categorized failure analysis

## 📚 References

### Technical Standards
- **Ed25519**: RFC 8032 - Edwards-Curve Digital Signature Algorithm
- **Keccak-256**: SHA-3 Standard (FIPS PUB 202)
- **Solana Programs**: Anchor Framework Documentation
- **Cross-Chain Messaging**: Via Labs Protocol Specification

### Security Best Practices
- **Multi-Signature Security**: Threshold Cryptography Principles
- **Replay Attack Prevention**: Nonce-based Transaction Ordering
- **Authority Management**: Least Privilege Access Control
- **Emergency Procedures**: Circuit Breaker Pattern Implementation

---

*This document represents the current security architecture as of implementation. For operational questions, contact the Via Labs development team.*