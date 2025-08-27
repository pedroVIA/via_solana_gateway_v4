# Solana Program Deployment Guide

## Program ID Management

### How Program IDs Work
- **Program ID is derived from a keypair** stored in `/target/deploy/message_gateway_v4-keypair.json`
- **Same keypair = Same program ID** every time you deploy
- **Different networks require different program IDs** - you cannot reuse the same ID across networks

### Program ID Persistence

#### Local Development (Localnet)
- Program ID remains the same unless you:
  - Delete the keypair file in `/target/deploy/`
  - Run `anchor clean` (removes everything except keypairs by default)
  - Manually generate a new keypair with `solana-keygen new`
- Current local program ID: `4hjwz5e8jYyj13wqRsUbvJYyCrsjt3EwSDRmppLJkjYL`
- You can redeploy over the same program ID with `anchor deploy`
- Program state persists until validator restart

#### Production Networks (Devnet/Testnet/Mainnet)
- Each network needs its own unique program ID
- Program ID becomes permanent once deployed
- Upgrades use the same ID but require upgrade authority

## Deployment Steps by Network

### Local Development
```bash
# Build the program
anchor build

# Deploy to localnet (uses existing keypair)
anchor deploy

# Program ID stays the same across redeployments
```

### Devnet Deployment (Free - for testing)
```bash
# 1. Generate a devnet-specific keypair
solana-keygen new -o target/deploy/message_gateway_v4-devnet-keypair.json

# 2. Get the program ID from this keypair
solana address -k target/deploy/message_gateway_v4-devnet-keypair.json

# 3. Update lib.rs with the devnet program ID
# declare_id!("YOUR_DEVNET_PROGRAM_ID");

# 4. Update Anchor.toml
# [programs.devnet]
# message_gateway_v4 = "YOUR_DEVNET_PROGRAM_ID"

# 5. Build with the new ID
anchor build

# 6. Deploy to devnet
anchor deploy --program-keypair target/deploy/message_gateway_v4-devnet-keypair.json --provider.cluster devnet
```

### Mainnet Deployment (Expensive - ~3-5 SOL)
```bash
# 1. Generate a NEW keypair specifically for mainnet
solana-keygen new -o target/deploy/message_gateway_v4-mainnet-keypair.json

# 2. Get the program ID from this keypair
solana address -k target/deploy/message_gateway_v4-mainnet-keypair.json

# 3. Update lib.rs with the mainnet program ID
# declare_id!("YOUR_MAINNET_PROGRAM_ID");

# 4. Update Anchor.toml
# [programs.mainnet]
# message_gateway_v4 = "YOUR_MAINNET_PROGRAM_ID"

# 5. Build with the new ID
anchor build

# 6. Deploy ONCE to mainnet (costs ~3-5 SOL)
anchor deploy --program-keypair target/deploy/message_gateway_v4-mainnet-keypair.json --provider.cluster mainnet-beta
```

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