use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GatewayError;
use crate::events::TxPdaCreated;
use crate::state::{CounterPDA, TxIdPDA, MessageSignature};
use crate::utils::{hash::create_message_hash_for_signing, signature::validate_signatures_tx1};

pub fn handler(
    ctx: Context<CreateTxPda>,
    tx_id: u128,
    source_chain_id: u64,
    dest_chain_id: u64,
    sender: Vec<u8>,
    recipient: Vec<u8>,
    on_chain_data: Vec<u8>,
    off_chain_data: Vec<u8>,
    signatures: Vec<MessageSignature>,
) -> Result<()> {
    // Input validation for DOS protection
    require!(sender.len() <= MAX_SENDER_SIZE, GatewayError::SenderTooLong);
    require!(recipient.len() <= MAX_RECIPIENT_SIZE, GatewayError::RecipientTooLong);
    require!(on_chain_data.len() <= MAX_ON_CHAIN_DATA_SIZE, GatewayError::OnChainDataTooLarge);
    require!(off_chain_data.len() <= MAX_OFF_CHAIN_DATA_SIZE, GatewayError::OffChainDataTooLarge);
    
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
    
    // TX1 basic signature validation (cryptographic verification only)
    validate_signatures_tx1(&signatures, &message_hash, &ctx.accounts.instructions)?;
    // Initialize TxId PDA (proves this tx_id hasn't been processed)
    let tx_pda = &mut ctx.accounts.tx_id_pda;
    tx_pda.tx_id = tx_id;
    tx_pda.bump = ctx.bumps.tx_id_pda;
    
    // Initialize counter if new, otherwise it already exists
    let counter = &mut ctx.accounts.counter_pda;
    if counter.source_chain_id == 0 {
        // New counter - initialize
        counter.source_chain_id = source_chain_id;
        counter.bump = ctx.bumps.counter_pda;
        counter.highest_tx_id_seen = 0;
    }
    
    // Update Counter PDA with highest tx_id seen
    let counter = &mut ctx.accounts.counter_pda;
    if tx_id > counter.highest_tx_id_seen {
        counter.highest_tx_id_seen = tx_id;
    }
    
    emit!(TxPdaCreated {
        tx_id,
        source_chain_id,
    });
    
    msg!("TxId PDA created for tx_id={}", tx_id);
    Ok(())
}

#[derive(Accounts)]
#[instruction(tx_id: u128, source_chain_id: u64, dest_chain_id: u64, sender: Vec<u8>, recipient: Vec<u8>, on_chain_data: Vec<u8>, off_chain_data: Vec<u8>, signatures: Vec<MessageSignature>)]
pub struct CreateTxPda<'info> {
    #[account(
        init,
        payer = relayer,
        space = 8 + TxIdPDA::SIZE,
        seeds = [
            TX_SEED,
            source_chain_id.to_le_bytes().as_ref(),
            &tx_id.to_le_bytes()
        ],
        bump
    )]
    pub tx_id_pda: Account<'info, TxIdPDA>,
    
    #[account(
        init_if_needed,
        payer = relayer,
        space = 8 + CounterPDA::SIZE,
        seeds = [
            COUNTER_SEED,
            source_chain_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub counter_pda: Account<'info, CounterPDA>,
    
    #[account(mut)]
    pub relayer: Signer<'info>,
    
    /// CHECK: Instructions sysvar for Ed25519 signature verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}