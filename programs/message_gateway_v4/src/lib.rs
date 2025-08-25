use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("4Y3nNvrMJVybZStQAKdvPBPREr7fRuCjkSKe9yPg86We");

/// Via Labs V4 Message Gateway Program
/// 
/// Core cross-chain messaging protocol implementation for Solana
/// featuring two-transaction replay protection and three-layer security
#[program]
pub mod message_gateway_v4 {
    use super::*;

    /// Initialize the gateway for a specific chain
    pub fn initialize_gateway(
        ctx: Context<InitializeGateway>,
        chain_id: u64,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, chain_id)
    }

    /// Send a cross-chain message
    pub fn send_message(
        ctx: Context<SendMessage>,
        tx_id: u128,
        recipient: Vec<u8>,
        dest_chain_id: u64,
        chain_data: Vec<u8>,
        confirmations: u16,
    ) -> Result<()> {
        instructions::send_message::handler(ctx, tx_id, recipient, dest_chain_id, chain_data, confirmations)
    }

    /// TX1: Create TxId PDA for replay protection
    pub fn create_tx_pda(
        ctx: Context<CreateTxPda>,
        tx_id: u128,
        source_chain_id: u64,
    ) -> Result<()> {
        instructions::create_tx_pda::handler(ctx, tx_id, source_chain_id)
    }

    /// TX2: Process message with atomic PDA closure
    pub fn process_message(
        ctx: Context<ProcessMessage>,
        tx_id: u128,
        source_chain_id: u64,
        dest_chain_id: u64,
        sender: Vec<u8>,
        recipient: Vec<u8>,
        on_chain_data: Vec<u8>,
        off_chain_data: Vec<u8>,
    ) -> Result<()> {
        instructions::process_message::handler(
            ctx,
            tx_id,
            source_chain_id,
            dest_chain_id,
            sender,
            recipient,
            on_chain_data,
            off_chain_data,
        )
    }

    /// Update system enabled status (admin only)
    pub fn set_system_enabled(
        ctx: Context<SetSystemEnabled>,
        enabled: bool,
    ) -> Result<()> {
        instructions::admin::set_system_enabled(ctx, enabled)
    }
}