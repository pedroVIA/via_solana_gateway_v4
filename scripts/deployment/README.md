# Via Labs V4 Deployment System

## Quick Start

### One-Command Deployment
```bash
# Deploy to any network with full automation
yarn deploy:localnet          # Local development
yarn deploy:devnet            # Devnet testing
yarn deploy:testnet           # Testnet validation
yarn deploy:mainnet           # Production deployment

# With options
yarn deploy devnet --verbose              # Verbose logging
yarn deploy mainnet --dry-run             # Test without deploying
yarn deploy localnet --skip-pre-validation # Skip validation
```

### Network Management
```bash
# Manage network configurations
yarn network:list             # List all networks
yarn network:prepare devnet   # Prepare devnet for deployment
yarn network:validate mainnet # Validate mainnet requirements
```

## Architecture

### Files Structure
```
scripts/deployment/
├── README.md              # This file
├── network-config.json    # Network definitions and requirements
├── network-manager.ts     # Network and program ID management
└── deploy.ts             # Main deployment orchestrator
```

### Deployment Phases

1. **Pre-deployment Validation**
   - CLI tools availability check
   - Network validation
   - Working directory status

2. **Network Preparation** 
   - Keypair generation (if needed)
   - Configuration file updates
   - Program ID management

3. **Build**
   - Clean previous artifacts
   - Anchor build
   - Program size calculation

4. **Deploy**
   - Network-specific deployment
   - Transaction tracking
   - Program ID verification

5. **Post-deployment Validation**
   - Network accessibility check
   - Program verification

### Features

✅ **Multi-network support** - Localnet, Devnet, Testnet, Mainnet  
✅ **Automated keypair management** - Network-specific program IDs  
✅ **Pre-flight validation** - Comprehensive requirement checks  
✅ **Progress tracking** - Build metrics and timing  
✅ **Error handling** - Detailed error reporting with rollback  
✅ **Dry run mode** - Test deployments without spending SOL  
✅ **Verbose logging** - Detailed operation logs  

### Safety Features

🛡️ **Network isolation** - Separate keypairs per network  
🛡️ **Validation gates** - Multi-stage validation before deployment  
🛡️ **Cost awareness** - Clear cost implications for mainnet  
🛡️ **Rollback support** - Safe failure handling  
🛡️ **Configuration management** - Automated config synchronization  

## Complete Deployment Workflow

### 1. Environment Setup
```bash
# List available environment profiles
yarn env:list

# Generate environment configuration
yarn env:generate devnet

# Validate environment setup
yarn env:validate
```

### 2. Network Preparation  
```bash
# List available networks
yarn network:list

# Prepare target network (generates keypairs, updates configs)
yarn network:prepare devnet

# Validate network requirements
yarn network:validate devnet
```

### 3. Deployment
```bash
# Deploy to network with full automation
yarn deploy devnet --verbose

# Or use network-specific shortcuts
yarn deploy:devnet
yarn deploy:localnet
yarn deploy:mainnet
```

### 4. Post-Deployment Setup
```bash
# Initialize gateways and signer registries
yarn setup devnet

# Or use network-specific shortcuts
yarn setup:devnet
yarn setup:localnet
```

### 5. Verification & Monitoring
```bash
# Verify deployment success
yarn verify devnet

# Run health checks
yarn health devnet

# Continuous monitoring
yarn health devnet --continuous --interval 60000
```

### Mainnet Deployment (Production)
```bash
# 1. Dry run first
yarn deploy mainnet --dry-run

# 2. Final validation
yarn network:validate mainnet

# 3. Production deployment
yarn deploy mainnet --verbose
```

### Development Workflow
```bash
# Quick local deployment
yarn deploy:localnet

# Or with full validation
yarn deploy localnet --verbose
```

## Error Recovery

### Common Issues and Solutions

1. **Program ID Mismatch**
   ```bash
   yarn network:update-config
   anchor build
   ```

2. **Insufficient Balance**
   ```bash
   solana balance
   solana airdrop 2  # For devnet/testnet only
   ```

3. **Network Unreachable**
   ```bash
   yarn network:validate <network>
   solana config get
   ```

4. **Build Failures**
   ```bash
   anchor clean
   anchor build
   ```

## Integration with Existing Workflow

The new deployment system enhances rather than replaces existing Anchor commands:

### Before (Manual)
```bash
solana-keygen new -o target/deploy/program-devnet-keypair.json
# Edit Anchor.toml manually
# Edit lib.rs manually  
anchor build
anchor deploy --provider.cluster devnet --program-keypair target/deploy/program-devnet-keypair.json
```

### After (Automated)
```bash
yarn deploy:devnet
```

Both approaches work, but the automated approach provides:
- Consistency across deployments
- Error prevention
- Progress tracking
- Post-deployment verification
- Easy network switching