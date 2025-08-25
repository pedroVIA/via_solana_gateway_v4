use anchor_lang::prelude::*;

/// TxId PDA for two-transaction replay protection
/// Created in TX1, closed in TX2 (rent reclaimed)
#[account]
pub struct TxIdPDA {
    /// Transaction ID from source chain
    pub tx_id: u128,
    
    /// PDA bump seed
    pub bump: u8,
}

impl TxIdPDA {
    pub const SIZE: usize = 16  // tx_id (u128)
        + 1;                    // bump
}