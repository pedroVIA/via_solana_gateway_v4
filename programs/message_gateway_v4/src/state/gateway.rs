use anchor_lang::prelude::*;

/// Main gateway account storing configuration and state
#[account]
pub struct MessageGateway {
    /// Admin authority that can modify gateway settings
    pub authority: Pubkey,
    
    /// Chain identifier for this gateway instance
    pub chain_id: u64,
    
    /// System enable flag for emergency stops
    pub system_enabled: bool,
    
    /// PDA bump seed
    pub bump: u8,
}

impl MessageGateway {
    pub const SIZE: usize = 32  // authority
        + 8                     // chain_id
        + 1                     // system_enabled
        + 1;                    // bump
}