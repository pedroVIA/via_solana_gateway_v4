use anchor_lang::prelude::*;

use crate::constants::*;
use crate::events::TxPdaCreated;
use crate::state::{CounterPDA, TxIdPDA};

pub fn handler(
    ctx: Context<CreateTxPda>,
    tx_id: u128,
    source_chain_id: u64,
) -> Result<()> {
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
#[instruction(tx_id: u128, source_chain_id: u64)]
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
    
    pub system_program: Program<'info, System>,
}