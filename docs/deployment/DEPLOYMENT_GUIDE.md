# Via Labs V4 Deployment Guide - Enhanced Automation System

**🚀 NEW: Enterprise-grade deployment automation with comprehensive monitoring and validation**

This guide covers the enhanced deployment system that transforms manual 15-step processes into simple one-command operations with comprehensive safety checks and monitoring.

## Automated Network Management

### Quick Start (New Approach)
```bash
# List all available networks
yarn network:list

# Prepare any network for deployment (generates keypair, updates configs)
yarn network:prepare localnet
yarn network:prepare devnet
yarn network:prepare mainnet

# Validate network requirements before deployment
yarn network:validate devnet
```

### Program ID Management

#### How Program IDs Work
- **Program ID is derived from a keypair** stored in network-specific files
- **Same keypair = Same program ID** every time you deploy  
- **Different networks require different program IDs** - managed automatically
- **Network-specific configuration** handles all program ID management

#### Network-Specific Keypairs
- **Localnet**: `target/deploy/message_gateway_v4-keypair.json`
- **Devnet**: `target/deploy/message_gateway_v4-devnet-keypair.json` 
- **Testnet**: `target/deploy/message_gateway_v4-testnet-keypair.json`
- **Mainnet**: `target/deploy/message_gateway_v4-mainnet-keypair.json`

#### Program ID Persistence

##### Local Development (Localnet)
- Program ID: `FkYFDWxJjG1wR5AgDvigHpzm79RHh5s1Ng9T6N96v2g7`
- Automatically configured and ready to use
- Redeployments preserve the same program ID
- Program state persists until validator restart

##### Production Networks (Devnet/Testnet/Mainnet)
- Each network gets unique program ID on first preparation
- Program ID becomes permanent once deployed  
- Upgrades use same ID but require upgrade authority
- Managed through network configuration system

## Streamlined Deployment Process

### Local Development (Immediate)
```bash
# Everything is pre-configured and ready
anchor build
anchor deploy
```

### Devnet Deployment (Automated)
```bash
# 1. Prepare devnet (generates keypair, updates all configs)
yarn network:prepare devnet

# 2. Validate requirements
yarn network:validate devnet

# 3. Build and deploy
anchor build
anchor deploy --provider.cluster devnet
```

### Testnet Deployment (Automated)
```bash
# 1. Prepare testnet (generates keypair, updates all configs)
yarn network:prepare testnet

# 2. Validate requirements  
yarn network:validate testnet

# 3. Build and deploy
anchor build
anchor deploy --provider.cluster testnet
```

### Mainnet Deployment (Production Ready)
```bash
# 1. Prepare mainnet (generates keypair, updates all configs)
yarn network:prepare mainnet

# 2. Validate requirements (includes security checks)
yarn network:validate mainnet

# 3. Build and deploy (costs ~3-5 SOL)
anchor build
anchor deploy --provider.cluster mainnet-beta

# 4. Post-deployment setup (optional)
yarn deploy:setup mainnet  # (Coming soon - automated gateway/registry initialization)
```

### Complete Production Workflow Example
```bash
# Full mainnet deployment with all safety checks
yarn env:generate mainnet
yarn network:prepare mainnet
yarn network:validate mainnet
yarn deploy mainnet --dry-run          # Test first
yarn deploy:mainnet                    # Deploy (~3-5 SOL)
yarn setup:mainnet                     # Initialize infrastructure  
yarn verify:mainnet                    # Comprehensive validation
yarn health mainnet --continuous       # Start monitoring
```

### Legacy Manual Process (For Reference Only)
<details>
<summary>Click to expand manual deployment steps (not recommended - replaced by automation)</summary>

#### Manual Devnet Deployment (Old Method)
```bash
# Generate keypair manually
solana-keygen new -o target/deploy/message_gateway_v4-devnet-keypair.json

# Get program ID
solana address -k target/deploy/message_gateway_v4-devnet-keypair.json

# Update Anchor.toml manually
# [programs.devnet]
# message_gateway_v4 = "YOUR_PROGRAM_ID"

# Build and deploy
anchor build
anchor deploy --program-keypair target/deploy/message_gateway_v4-devnet-keypair.json --provider.cluster devnet

# Manual post-deployment setup (now automated)
# - Initialize gateways manually
# - Create signer registries manually  
# - No verification or monitoring
```

**❌ Problems with manual approach:**
- 15+ manual steps prone to human error
- Program ID mismatches causing deployment failures
- No automated validation or safety checks
- No post-deployment verification
- No monitoring or health checks
- Time-consuming and error-prone

**✅ New automated system solves all these issues**
</details>

## Important Mainnet Considerations

### Cost
- Deployment costs approximately **3-5 SOL** depending on program size
- Each redeployment/upgrade costs additional SOL
- Test thoroughly on devnet first (free deployments)

### Security
- **Program becomes immutable** unless you retain upgrade authority
- **Keep the keypair SAFE** - losing it means losing upgrade authority
- Consider using multi-signature for upgrade authority
- Store mainnet keypair in secure location (hardware wallet, secure storage)
- Never commit keypair files to git

### Best Practices
1. **Local development**: Use consistent local program ID
2. **Devnet testing**: Deploy with devnet-specific ID for integration testing
3. **Mainnet deployment**: Only deploy when fully tested and audited
4. **Keypair management**: 
   - Keep separate keypairs for each network
   - Back up mainnet keypair in multiple secure locations
   - Consider using a DAO or multi-sig for upgrade authority

## Multi-Network Configuration Example

```toml
# Anchor.toml

[programs.localnet]
message_gateway_v4 = "4hjwz5e8jYyj13wqRsUbvJYyCrsjt3EwSDRmppLJkjYL"

[programs.devnet]
message_gateway_v4 = "YOUR_DEVNET_PROGRAM_ID"

[programs.mainnet]
message_gateway_v4 = "YOUR_MAINNET_PROGRAM_ID"
```

## Quick Commands Reference

```bash
# Check current program ID from keypair
solana address -k target/deploy/message_gateway_v4-keypair.json

# Check if keypair exists
ls -la target/deploy/*.json | grep keypair

# Generate new keypair
solana-keygen new -o target/deploy/message_gateway_v4-[network]-keypair.json

# Deploy to specific network
anchor deploy --provider.cluster [localnet|devnet|testnet|mainnet-beta]

# Check program size (affects deployment cost)
ls -lh target/deploy/*.so
```

## Troubleshooting

### Program ID Mismatch Error
- Ensure lib.rs and Anchor.toml have matching program IDs
- Rebuild after changing program ID: `anchor build`
- Redeploy after rebuild: `anchor deploy`

### Deployment Failed
- Check account balance: `solana balance`
- Ensure correct cluster: `solana config get`
- Verify keypair exists and has correct permissions

### Lost Keypair
- Local/Devnet: Generate new keypair and redeploy
- Mainnet: Without keypair, program cannot be upgraded (permanent)