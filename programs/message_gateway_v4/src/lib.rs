use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("4hjwz5e8jYyj13wqRsUbvJYyCrsjt3EwSDRmppLJkjYL");

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
        dest_chain_id: u64,
        sender: Vec<u8>,
        recipient: Vec<u8>,
        on_chain_data: Vec<u8>,
        off_chain_data: Vec<u8>,
        signatures: Vec<crate::state::MessageSignature>,
    ) -> Result<()> {
        instructions::create_tx_pda::handler(
            ctx,
            tx_id,
            source_chain_id,
            dest_chain_id,
            sender,
            recipient,
            on_chain_data,
            off_chain_data,
            signatures,
        )
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
        signatures: Vec<crate::state::MessageSignature>,
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
            signatures,
        )
    }

    /// Update system enabled status (admin only)
    pub fn set_system_enabled(
        ctx: Context<SetSystemEnabled>,
        enabled: bool,
    ) -> Result<()> {
        instructions::admin::set_system_enabled(ctx, enabled)
    }

    /// Initialize a signer registry
    pub fn initialize_signer_registry(
        ctx: Context<InitializeSignerRegistry>,
        registry_type: crate::state::SignerRegistryType,
        chain_id: u64,
        initial_signers: Vec<Pubkey>,
        required_signatures: u8,
    ) -> Result<()> {
        instructions::signer_registry::initialize_signer_registry(
            ctx,
            registry_type,
            chain_id,
            initial_signers,
            required_signatures,
        )
    }

    /// Update signers in an existing registry
    pub fn update_signers(
        ctx: Context<UpdateSigners>,
        registry_type: crate::state::SignerRegistryType,
        chain_id: u64,
        new_signers: Vec<Pubkey>,
        new_required_signatures: u8,
    ) -> Result<()> {
        instructions::signer_registry::update_signers(
            ctx,
            registry_type,
            chain_id,
            new_signers,
            new_required_signatures,
        )
    }

    /// Add a signer to an existing registry
    pub fn add_signer(
        ctx: Context<AddSigner>,
        registry_type: crate::state::SignerRegistryType,
        chain_id: u64,
        new_signer: Pubkey,
    ) -> Result<()> {
        instructions::signer_registry::add_signer(ctx, registry_type, chain_id, new_signer)
    }

    /// Remove a signer from an existing registry
    pub fn remove_signer(
        ctx: Context<RemoveSigner>,
        registry_type: crate::state::SignerRegistryType,
        chain_id: u64,
        signer_to_remove: Pubkey,
    ) -> Result<()> {
        instructions::signer_registry::remove_signer(ctx, registry_type, chain_id, signer_to_remove)
    }

    /// Update signature threshold for a registry
    pub fn update_threshold(
        ctx: Context<UpdateThreshold>,
        registry_type: crate::state::SignerRegistryType,
        chain_id: u64,
        new_threshold: u8,
    ) -> Result<()> {
        instructions::signer_registry::update_threshold(ctx, registry_type, chain_id, new_threshold)
    }

    /// Enable or disable a signer registry
    pub fn set_registry_enabled(
        ctx: Context<SetRegistryEnabled>,
        registry_type: crate::state::SignerRegistryType,
        chain_id: u64,
        enabled: bool,
    ) -> Result<()> {
        instructions::signer_registry::set_registry_enabled(ctx, registry_type, chain_id, enabled)
    }
}