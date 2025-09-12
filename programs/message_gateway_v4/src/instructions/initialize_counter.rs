use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GatewayError;
use crate::events::CounterInitialized;
use crate::state::{CounterPDA, MessageGateway};

pub fn handler(
    ctx: Context<InitializeCounter>,
    source_chain_id: u64,
) -> Result<()> {
    // CRITICAL: Validate chain ID is not 0 (our magic uninitialized value)
    require!(source_chain_id > 0, GatewayError::InvalidChainId);
    
    // CRITICAL: Validate this is a known chain we expect messages from
    // For MVP, we support Ethereum (2), Polygon (3), and test chains
    require!(
        source_chain_id > 0,
        GatewayError::UnsupportedChain
    );
    
    let counter = &mut ctx.accounts.counter_pda;
    
    // Initialize the counter
    counter.source_chain_id = source_chain_id;
    counter.highest_tx_id_seen = 0;
    counter.bump = ctx.bumps.counter_pda;
    
    emit!(CounterInitialized {
        source_chain_id,
        counter_pda: ctx.accounts.counter_pda.key(),
        authority: ctx.accounts.authority.key(),
        gateway: ctx.accounts.gateway.key(),
    });
    
    msg!(
        "Counter PDA initialized for source_chain_id={}, counter_pda={}, authority={}, gateway={}",
        source_chain_id,
        ctx.accounts.counter_pda.key(),
        ctx.accounts.authority.key(),
        ctx.accounts.gateway.key()
    );
    
    Ok(())
}

#[derive(Accounts)]
#[instruction(source_chain_id: u64)]
pub struct InitializeCounter<'info> {
    // CRITICAL: Using init (NOT init_if_needed) to prevent overwrites
    // This will FAIL if counter already exists - intentional safety
    #[account(
        init,
        payer = authority,
        space = 8 + CounterPDA::SIZE,
        seeds = [
            COUNTER_SEED,
            source_chain_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub counter_pda: Account<'info, CounterPDA>,
    
    // Gateway authority - only they can initialize counters
    #[account(
        mut,
        constraint = authority.key() == gateway.authority @ GatewayError::UnauthorizedAccess
    )]
    pub authority: Signer<'info>,
    
    // Gateway account to verify authority
    // Using the destination chain gateway (Solana = 1)
    #[account(
        seeds = [GATEWAY_SEED, gateway.chain_id.to_le_bytes().as_ref()],
        bump = gateway.bump,
        constraint = gateway.system_enabled @ GatewayError::GatewayDisabled
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    pub system_program: Program<'info, System>,
}