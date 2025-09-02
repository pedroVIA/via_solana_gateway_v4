use anchor_lang::prelude::*;
use crate::{
    constants::{SIGNER_REGISTRY_SEED, MAX_SIGNERS_PER_REGISTRY},
    errors::GatewayError,
    state::{MessageGateway, SignerRegistry, SignerRegistryType},
};

/// Initialize a signer registry for a specific tier and chain
#[derive(Accounts)]
#[instruction(registry_type: SignerRegistryType, chain_id: u64)]
pub struct InitializeSignerRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = SignerRegistry::space(MAX_SIGNERS_PER_REGISTRY),
        seeds = [
            SIGNER_REGISTRY_SEED,
            &registry_type.discriminant().to_le_bytes(),
            &chain_id.to_le_bytes()
        ],
        bump
    )]
    pub signer_registry: Account<'info, SignerRegistry>,
    
    #[account(
        seeds = [crate::constants::GATEWAY_SEED, &gateway.chain_id.to_le_bytes()],
        bump = gateway.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_signer_registry(
    ctx: Context<InitializeSignerRegistry>,
    registry_type: SignerRegistryType,
    chain_id: u64,
    initial_signers: Vec<Pubkey>,
    required_signatures: u8,
) -> Result<()> {
    require!(!initial_signers.is_empty(), GatewayError::InsufficientSignatures);
    require!(
        initial_signers.len() <= MAX_SIGNERS_PER_REGISTRY,
        GatewayError::TooManySignatures
    );
    require!(
        required_signatures > 0 && required_signatures <= initial_signers.len() as u8,
        GatewayError::InvalidThreshold
    );
    
    let registry = &mut ctx.accounts.signer_registry;
    registry.registry_type = registry_type.clone();
    registry.authority = ctx.accounts.authority.key();
    registry.signers = initial_signers.clone();
    registry.required_signatures = required_signatures;
    registry.chain_id = chain_id;
    registry.enabled = true;
    registry.bump = ctx.bumps.signer_registry;
    
    msg!(
        "Initialized {:?} signer registry for chain {} with {} signers, requiring {} signatures",
        registry_type,
        chain_id,
        initial_signers.len(),
        required_signatures
    );
    
    Ok(())
}

/// Update signers in an existing registry
#[derive(Accounts)]
#[instruction(registry_type: SignerRegistryType, chain_id: u64)]
pub struct UpdateSigners<'info> {
    #[account(
        mut,
        seeds = [
            SIGNER_REGISTRY_SEED,
            &registry_type.discriminant().to_le_bytes(),
            &chain_id.to_le_bytes()
        ],
        bump = signer_registry.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub signer_registry: Account<'info, SignerRegistry>,
    
    #[account(
        seeds = [crate::constants::GATEWAY_SEED, &gateway.chain_id.to_le_bytes()],
        bump = gateway.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    pub authority: Signer<'info>,
}

pub fn update_signers(
    ctx: Context<UpdateSigners>,
    _registry_type: SignerRegistryType,
    _chain_id: u64,
    new_signers: Vec<Pubkey>,
    new_required_signatures: u8,
) -> Result<()> {
    require!(!new_signers.is_empty(), GatewayError::InsufficientSignatures);
    require!(
        new_signers.len() <= MAX_SIGNERS_PER_REGISTRY,
        GatewayError::TooManySignatures
    );
    require!(
        new_required_signatures > 0 && new_required_signatures <= new_signers.len() as u8,
        GatewayError::InvalidThreshold
    );
    
    let registry = &mut ctx.accounts.signer_registry;
    
    msg!(
        "Updating {:?} registry: old signers count={}, new signers count={}",
        registry.registry_type,
        registry.signers.len(),
        new_signers.len()
    );
    
    registry.signers = new_signers;
    registry.required_signatures = new_required_signatures;
    
    // Validate the new configuration
    registry.validate_threshold()?;
    
    msg!(
        "Updated {:?} signer registry: {} signers, requiring {} signatures",
        registry.registry_type,
        registry.signers.len(),
        new_required_signatures
    );
    
    Ok(())
}

/// Add a single signer to an existing registry
#[derive(Accounts)]
#[instruction(registry_type: SignerRegistryType, chain_id: u64)]
pub struct AddSigner<'info> {
    #[account(
        mut,
        seeds = [
            SIGNER_REGISTRY_SEED,
            &registry_type.discriminant().to_le_bytes(),
            &chain_id.to_le_bytes()
        ],
        bump = signer_registry.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub signer_registry: Account<'info, SignerRegistry>,
    
    #[account(
        seeds = [crate::constants::GATEWAY_SEED, &gateway.chain_id.to_le_bytes()],
        bump = gateway.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    pub authority: Signer<'info>,
}

pub fn add_signer(
    ctx: Context<AddSigner>,
    _registry_type: SignerRegistryType,
    _chain_id: u64,
    new_signer: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.signer_registry;
    
    require!(
        !registry.signers.contains(&new_signer),
        GatewayError::DuplicateSigner
    );
    require!(
        registry.signers.len() < MAX_SIGNERS_PER_REGISTRY,
        GatewayError::TooManySignatures
    );
    
    registry.signers.push(new_signer);
    
    msg!(
        "Added signer {} to {:?} registry (total signers: {})",
        new_signer,
        registry.registry_type,
        registry.signers.len()
    );
    
    Ok(())
}

/// Remove a signer from an existing registry
#[derive(Accounts)]
#[instruction(registry_type: SignerRegistryType, chain_id: u64)]
pub struct RemoveSigner<'info> {
    #[account(
        mut,
        seeds = [
            SIGNER_REGISTRY_SEED,
            &registry_type.discriminant().to_le_bytes(),
            &chain_id.to_le_bytes()
        ],
        bump = signer_registry.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub signer_registry: Account<'info, SignerRegistry>,
    
    #[account(
        seeds = [crate::constants::GATEWAY_SEED, &gateway.chain_id.to_le_bytes()],
        bump = gateway.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    pub authority: Signer<'info>,
}

pub fn remove_signer(
    ctx: Context<RemoveSigner>,
    _registry_type: SignerRegistryType,
    _chain_id: u64,
    signer_to_remove: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.signer_registry;
    
    let position = registry.signers.iter().position(|&s| s == signer_to_remove)
        .ok_or(GatewayError::UnauthorizedSigner)?;
    
    registry.signers.remove(position);
    
    // Ensure we still have enough signers for the threshold
    require!(
        registry.required_signatures <= registry.signers.len() as u8,
        GatewayError::ThresholdTooHigh
    );
    
    msg!(
        "Removed signer {} from {:?} registry (remaining signers: {})",
        signer_to_remove,
        registry.registry_type,
        registry.signers.len()
    );
    
    Ok(())
}

/// Update the required signature threshold for a registry
#[derive(Accounts)]
#[instruction(registry_type: SignerRegistryType, chain_id: u64)]
pub struct UpdateThreshold<'info> {
    #[account(
        mut,
        seeds = [
            SIGNER_REGISTRY_SEED,
            &registry_type.discriminant().to_le_bytes(),
            &chain_id.to_le_bytes()
        ],
        bump = signer_registry.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub signer_registry: Account<'info, SignerRegistry>,
    
    #[account(
        seeds = [crate::constants::GATEWAY_SEED, &gateway.chain_id.to_le_bytes()],
        bump = gateway.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    pub authority: Signer<'info>,
}

pub fn update_threshold(
    ctx: Context<UpdateThreshold>,
    _registry_type: SignerRegistryType,
    _chain_id: u64,
    new_threshold: u8,
) -> Result<()> {
    let registry = &mut ctx.accounts.signer_registry;
    
    require!(new_threshold > 0, GatewayError::InvalidThreshold);
    require!(
        new_threshold <= registry.signers.len() as u8,
        GatewayError::ThresholdTooHigh
    );
    
    let old_threshold = registry.required_signatures;
    registry.required_signatures = new_threshold;
    
    msg!(
        "Updated {:?} registry threshold from {} to {}",
        registry.registry_type,
        old_threshold,
        new_threshold
    );
    
    Ok(())
}

/// Enable or disable a signer registry
#[derive(Accounts)]
#[instruction(registry_type: SignerRegistryType, chain_id: u64)]
pub struct SetRegistryEnabled<'info> {
    #[account(
        mut,
        seeds = [
            SIGNER_REGISTRY_SEED,
            &registry_type.discriminant().to_le_bytes(),
            &chain_id.to_le_bytes()
        ],
        bump = signer_registry.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub signer_registry: Account<'info, SignerRegistry>,
    
    #[account(
        seeds = [crate::constants::GATEWAY_SEED, &gateway.chain_id.to_le_bytes()],
        bump = gateway.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    pub authority: Signer<'info>,
}

pub fn set_registry_enabled(
    ctx: Context<SetRegistryEnabled>,
    _registry_type: SignerRegistryType,
    _chain_id: u64,
    enabled: bool,
) -> Result<()> {
    let registry = &mut ctx.accounts.signer_registry;
    registry.enabled = enabled;
    
    msg!(
        "Set {:?} registry enabled status to: {}",
        registry.registry_type,
        enabled
    );
    
    Ok(())
}