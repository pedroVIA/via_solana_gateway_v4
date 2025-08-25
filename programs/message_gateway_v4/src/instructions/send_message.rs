use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GatewayError;
use crate::events::SendRequested;
use crate::state::MessageGateway;

pub fn handler(
    ctx: Context<SendMessage>,
    tx_id: u128,
    recipient: Vec<u8>,
    dest_chain_id: u64,
    chain_data: Vec<u8>,
    confirmations: u16,
) -> Result<()> {
    let gateway = &mut ctx.accounts.gateway;
    
    // Validate system is enabled
    require!(gateway.system_enabled, GatewayError::SystemDisabled);
    
    // Validate inputs
    require!(!recipient.is_empty(), GatewayError::EmptyRecipient);
    require!(!chain_data.is_empty(), GatewayError::EmptyChainData);
    
    // DOS protection: validate data sizes
    require!(
        recipient.len() <= MAX_RECIPIENT_SIZE,
        GatewayError::RecipientTooLong
    );
    require!(
        chain_data.len() <= MAX_ON_CHAIN_DATA_SIZE,
        GatewayError::OnChainDataTooLarge
    );
    
    // tx_id is provided as parameter
    
    // Emit event for off-chain processing
    emit!(SendRequested {
        tx_id,
        sender: ctx.accounts.sender.key().to_bytes(),
        recipient: recipient.clone(),
        dest_chain_id,
        chain_data: chain_data.clone(),
        confirmations,
        // timestamp: Clock::get()?.unix_timestamp,
    });
    
    msg!("Message sent: tx_id={}, dest_chain={:?}", tx_id, dest_chain_id);
    Ok(())
}

#[derive(Accounts)]
pub struct SendMessage<'info> {
    #[account(
        mut,
        seeds = [GATEWAY_SEED, gateway.chain_id.to_le_bytes().as_ref()],
        bump = gateway.bump
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    pub sender: Signer<'info>,
}