use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GatewayError;
use crate::events::MessageProcessed;
use crate::state::{MessageGateway, TxIdPDA};

pub fn handler(
    ctx: Context<ProcessMessage>,
    tx_id: u128,
    source_chain_id: u64,
    dest_chain_id: u64,
    sender: Vec<u8>,
    recipient: Vec<u8>,
    on_chain_data: Vec<u8>,
    off_chain_data: Vec<u8>,
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
    
    // For MVP: Skip signature validation (will add in next iteration)
    msg!(
        "Processing message tx_id={} from chain {:?}",
        tx_id,
        source_chain_id
    );
    
    // TODO: In production, add:
    // - Signature validation (3-layer security)
    // - CPI to recipient program
    // - Gas refund processing
    
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
#[instruction(tx_id: u128, source_chain_id: u64)]
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
    
    #[account(mut)]
    pub relayer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}