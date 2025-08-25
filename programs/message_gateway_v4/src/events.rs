use anchor_lang::prelude::*;

/// Event emitted when a message is sent
#[event]
pub struct SendRequested {
    pub tx_id: u128,
    pub sender: [u8; 32],
    pub recipient: Vec<u8>,
    pub dest_chain_id: u64,
    pub chain_data: Vec<u8>,
    pub confirmations: u16,
    // pub timestamp: i64, 
}

/// Event emitted when TxId PDA is created (TX1)
#[event]
pub struct TxPdaCreated {
    pub tx_id: u128,
    pub source_chain_id: u64,
}

/// Event emitted when a message is processed (TX2)
#[event]
pub struct MessageProcessed {
    pub tx_id: u128,
    pub source_chain_id: u64,
    pub relayer: Pubkey,
    // pub processed_at: i64,
}

/// Event emitted when system status changes
#[event]
pub struct SystemStatusChanged {
    pub enabled: bool,
}