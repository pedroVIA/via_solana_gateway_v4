use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GatewayError;
use crate::events::SystemStatusChanged;
use crate::state::MessageGateway;

pub fn set_system_enabled(ctx: Context<SetSystemEnabled>, enabled: bool) -> Result<()> {
    let gateway = &mut ctx.accounts.gateway;
    gateway.system_enabled = enabled;
    
    emit!(SystemStatusChanged { enabled });
    
    msg!("System {}", if enabled { "enabled" } else { "disabled" });
    Ok(())
}

#[derive(Accounts)]
pub struct SetSystemEnabled<'info> {
    #[account(
        mut,
        seeds = [GATEWAY_SEED, gateway.chain_id.to_le_bytes().as_ref()],
        bump = gateway.bump,
        has_one = authority @ GatewayError::UnauthorizedAuthority
    )]
    pub gateway: Account<'info, MessageGateway>,
    
    pub authority: Signer<'info>,
}