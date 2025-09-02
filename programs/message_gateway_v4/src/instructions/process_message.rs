use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GatewayError;
use crate::events::MessageProcessed;
use crate::state::{MessageGateway, TxIdPDA, SignerRegistry, MessageSignature};
use crate::utils::{
    hash::create_message_hash_for_signing,
    signature::validate_three_layer_signatures
};

pub fn handler(
    ctx: Context<ProcessMessage>,
    tx_id: u128,
    source_chain_id: u64,
    dest_chain_id: u64,
    sender: Vec<u8>,
    recipient: Vec<u8>,
    on_chain_data: Vec<u8>,
    off_chain_data: Vec<u8>,
    signatures: Vec<MessageSignature>,
) -> Result<()> {
    let gateway = &ctx.accounts.gateway;
    
    // Validate system is enabled
    require!(gateway.system_enabled, GatewayError::SystemDisabled);
    
    // Validate destination chain matches gateway
    require!(
        dest_chain_id == gateway.chain_id,
        GatewayError::InvalidDestChain
    );
    
    // DOS protection: validate input sizes
    require!(
        sender.len() <= MAX_SENDER_SIZE,
        GatewayError::SenderTooLong
    );
    require!(
        recipient.len() <= MAX_RECIPIENT_SIZE,
        GatewayError::RecipientTooLong
    );
    require!(
        on_chain_data.len() <= MAX_ON_CHAIN_DATA_SIZE,
        GatewayError::OnChainDataTooLarge
    );
    require!(
        off_chain_data.len() <= MAX_OFF_CHAIN_DATA_SIZE,
        GatewayError::OffChainDataTooLarge
    );
    
    // Verify TxId PDA exists (proves TX1 succeeded)
    require!(
        ctx.accounts.tx_id_pda.tx_id == tx_id,
        GatewayError::InvalidTxId
    );
    
    // Create message hash for signature validation
    let message_hash = create_message_hash_for_signing(
        tx_id,
        source_chain_id,
        dest_chain_id,
        &sender,
        &recipient,
        &on_chain_data,
        &off_chain_data,
    )?;
    
    // THREE-LAYER SIGNATURE VALIDATION - Production Security
    let validation_result = validate_three_layer_signatures(
        &signatures,
        &message_hash,
        &ctx.accounts.via_registry,
        &ctx.accounts.chain_registry,
        ctx.accounts.project_registry.as_ref().map(|acc| acc.as_ref()),
        &ctx.accounts.instructions,
    )?;
    
    msg!(
        "Message signature validation passed: VIA={}, Chain={}, Project={}, tx_id={}",
        validation_result.via_signatures,
        validation_result.chain_signatures,
        validation_result.project_signatures,
        tx_id
    );
    
    // TODO: Future enhancements:
    // - CPI to recipient program for message delivery
    // - Gas refund processing via gas handler
    
    // Emit event for successful processing
    emit!(MessageProcessed {
        tx_id,
        source_chain_id,
        relayer: ctx.accounts.relayer.key(),
       // processed_at: Clock::get()?.unix_timestamp,
    });
    
    // Note: The TxId PDA will be closed automatically by Anchor's close constraint
    // This reclaims rent (~0.002 SOL) back to relayer
    
    msg!("Message processed and TxId PDA closed for tx_id={}", tx_id);
    Ok(())
}

#[derive(Accounts)]
#[instruction(tx_id: u128, source_chain_id: u64, dest_chain_id: u64, sender: Vec<u8>, recipient: Vec<u8>, on_chain_data: Vec<u8>, off_chain_data: Vec<u8>, signatures: Vec<MessageSignature>)]
pub struct ProcessMessage<'info> {
    #[account(
        seeds = [GATEWAY_SEED, gateway.chain_id.to_le_bytes().as_ref()],
        bump = gateway.bump
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    /// TxId PDA that will be closed atomically
    #[account(
        mut,
        close = relayer, // Close and return rent to relayer
        seeds = [
            TX_SEED,
            source_chain_id.to_le_bytes().as_ref(),
            &tx_id.to_le_bytes()
        ],
        bump = tx_id_pda.bump
    )]
    pub tx_id_pda: Account<'info, TxIdPDA>,
    
    /// VIA signer registry for VIA-level validation
    #[account(
        seeds = [
            SIGNER_REGISTRY_SEED,
            &crate::state::SignerRegistryType::VIA.discriminant().to_le_bytes(),
            dest_chain_id.to_le_bytes().as_ref()
        ],
        bump = via_registry.bump
    )]
    pub via_registry: Account<'info, SignerRegistry>,
    
    /// Chain signer registry for source chain validation
    #[account(
        seeds = [
            SIGNER_REGISTRY_SEED,
            &crate::state::SignerRegistryType::Chain.discriminant().to_le_bytes(),
            source_chain_id.to_le_bytes().as_ref()
        ],
        bump = chain_registry.bump
    )]
    pub chain_registry: Account<'info, SignerRegistry>,
    
    /// Optional project signer registry for application-level validation
    pub project_registry: Option<Account<'info, SignerRegistry>>,
    
    #[account(mut)]
    pub relayer: Signer<'info>,
    
    /// CHECK: Instructions sysvar for Ed25519 signature verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}