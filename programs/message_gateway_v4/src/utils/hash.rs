use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use crate::errors::GatewayError;

/// Cross-chain compatible message hash generation
/// Creates destination-specific hashes that are consistent across chains
pub fn create_cross_chain_hash(
    tx_id: u128,
    source_chain_id: u64,
    dest_chain_id: u64,
    sender: &[u8],
    recipient: &[u8],
    on_chain_data: &[u8],
    off_chain_data: &[u8],
) -> Result<[u8; 32]> {
    // Validate input sizes to prevent hash collisions
    require!(sender.len() <= 64, GatewayError::SenderTooLong);
    require!(recipient.len() <= 64, GatewayError::RecipientTooLong);
    require!(on_chain_data.len() <= 1024, GatewayError::OnChainDataTooLarge);
    require!(off_chain_data.len() <= 1024, GatewayError::OffChainDataTooLarge);

    let mut encoded = Vec::new();
    
    // u128 tx_id (16 bytes, little endian) - Solana native format
    encoded.extend_from_slice(&tx_id.to_le_bytes());
    
    // u64 source_chain_id (8 bytes, little endian)
    encoded.extend_from_slice(&source_chain_id.to_le_bytes());
    
    // u64 dest_chain_id (8 bytes, little endian)
    encoded.extend_from_slice(&dest_chain_id.to_le_bytes());
    
    // Length-prefixed bytes (u32 length + data) - Solana style encoding
    encode_length_prefixed(&mut encoded, sender);
    encode_length_prefixed(&mut encoded, recipient);
    encode_length_prefixed(&mut encoded, on_chain_data);
    encode_length_prefixed(&mut encoded, off_chain_data);
    
    // Use Solana's keccak256 syscall for consistency
    let hash = keccak::hash(&encoded);
    
    msg!(
        "Generated hash for tx_id={}, source_chain={}, dest_chain={}, hash={:?}",
        tx_id,
        source_chain_id,
        dest_chain_id,
        hash.to_bytes()
    );
    
    Ok(hash.to_bytes())
}

/// Encode data with length prefix (u32 length + data bytes)
fn encode_length_prefixed(buffer: &mut Vec<u8>, data: &[u8]) {
    buffer.extend_from_slice(&(data.len() as u32).to_le_bytes());
    buffer.extend_from_slice(data);
}

/// Validate message hash format
pub fn validate_message_hash(hash: &[u8; 32]) -> Result<()> {
    // Ensure hash is not all zeros (invalid hash)
    require!(
        !hash.iter().all(|&b| b == 0),
        GatewayError::InvalidMessageHash
    );
    
    Ok(())
}

/// Create message hash for signature verification
/// This function creates the exact hash that off-chain validators sign
pub fn create_message_hash_for_signing(
    tx_id: u128,
    source_chain_id: u64,
    dest_chain_id: u64,
    sender: &[u8],
    recipient: &[u8],
    on_chain_data: &[u8],
    off_chain_data: &[u8],
) -> Result<[u8; 32]> {
    // This should match the hash format used by off-chain validators
    create_cross_chain_hash(
        tx_id,
        source_chain_id,
        dest_chain_id,
        sender,
        recipient,
        on_chain_data,
        off_chain_data,
    )
}

/// Verify message hash matches expected format
pub fn verify_hash_consistency(
    hash: &[u8; 32],
    tx_id: u128,
    source_chain_id: u64,
    dest_chain_id: u64,
    sender: &[u8],
    recipient: &[u8],
    on_chain_data: &[u8],
    off_chain_data: &[u8],
) -> Result<bool> {
    let calculated_hash = create_cross_chain_hash(
        tx_id,
        source_chain_id,
        dest_chain_id,
        sender,
        recipient,
        on_chain_data,
        off_chain_data,
    )?;
    
    Ok(hash == &calculated_hash)
}