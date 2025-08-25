use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::MessageGateway;

pub fn handler(ctx: Context<InitializeGateway>, chain_id: u64) -> Result<()> {
    let gateway = &mut ctx.accounts.gateway;
    
    // Set gateway configuration
    gateway.authority = ctx.accounts.authority.key();
    gateway.chain_id = chain_id;
    gateway.system_enabled = true;
    gateway.bump = ctx.bumps.gateway;
    
    msg!("Gateway initialized for chain: {:?}", chain_id);
    Ok(())
}

#[derive(Accounts)]
#[instruction(chain_id: u64)]
pub struct InitializeGateway<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MessageGateway::SIZE,
        seeds = [GATEWAY_SEED, chain_id.to_le_bytes().as_ref()],
        bump
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}