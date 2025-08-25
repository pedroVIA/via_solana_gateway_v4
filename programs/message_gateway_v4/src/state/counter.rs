use anchor_lang::prelude::*;

/// Counter PDA tracking message processing per source chain
/// Allows out-of-order message processing while detecting gaps
#[account]
pub struct CounterPDA {
    /// Source chain identifier
    pub source_chain_id: u64,
    
    /// Highest transaction ID seen from this chain
    pub highest_tx_id_seen: u128,
    
    /// PDA bump seed
    pub bump: u8,
}

impl CounterPDA {
    pub const SIZE: usize = 8   // source_chain_id
        + 16                    // highest_tx_id_seen (u128)
        + 1;                    // bump
}