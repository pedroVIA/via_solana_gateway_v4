use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    instruction::Instruction,
    sysvar::instructions::{self, load_instruction_at_checked}
};
use crate::{
    errors::GatewayError,
    state::{MessageSignature, SignerRegistry, SignerLayer, ValidationResult},
    constants::{MAX_SIGNATURES_PER_MESSAGE, MIN_SIGNATURES_REQUIRED},
    utils::hash::validate_message_hash,
};

/// Verify Ed25519 signature using Solana's Ed25519 program
/// This function checks if a valid Ed25519 instruction exists in the same transaction
pub fn verify_ed25519_signature(
    signature: &[u8; 64],
    signer: &Pubkey,
    message_hash: &[u8; 32],
    ix_sysvar_account: &AccountInfo,
) -> Result<bool> {
    // Validate inputs
    require!(
        signature.len() == 64,
        GatewayError::InvalidSignatureFormat
    );
    
    validate_message_hash(message_hash)?;
    
    // Get the current instruction index
    let current_index = instructions::load_current_index_checked(ix_sysvar_account)
        .map_err(|_| GatewayError::Ed25519VerificationFailed)?;
    
    // Look for Ed25519 instruction in this transaction
    for i in 0..current_index {
        if let Ok(ix) = load_instruction_at_checked(i as usize, ix_sysvar_account) {
            if ix.program_id == ed25519_program::ID {
                if let Some(is_valid) = parse_ed25519_instruction(&ix, signature, signer, message_hash) {
                    return Ok(is_valid);
                }
            }
        }
    }
    
    msg!("No matching Ed25519 instruction found for signature verification");
    Ok(false)
}

/// Parse Ed25519 instruction data to verify it matches our signature
fn parse_ed25519_instruction(
    ix: &Instruction,
    expected_signature: &[u8; 64],
    expected_signer: &Pubkey,
    expected_message: &[u8; 32],
) -> Option<bool> {
    // Ed25519 instruction format:
    // [0..16]   - signature offset info
    // [16..80]  - 64-byte signature
    // [80..112] - 32-byte pubkey
    // [112..]   - message data
    
    if ix.data.len() < 112 + expected_message.len() {
        return Some(false);
    }
    
    let ix_signature = &ix.data[16..80];
    let ix_pubkey = &ix.data[80..112];
    let ix_message = &ix.data[112..];
    
    // Verify all components match
    let signature_matches = ix_signature == expected_signature;
    let pubkey_matches = ix_pubkey == expected_signer.as_ref();
    let message_matches = ix_message == expected_message;
    
    msg!(
        "Ed25519 instruction verification: sig={}, pk={}, msg={}",
        signature_matches,
        pubkey_matches,
        message_matches
    );
    
    Some(signature_matches && pubkey_matches && message_matches)
}

/// Validate three-layer signatures according to Via Labs security model
pub fn validate_three_layer_signatures(
    signatures: &[MessageSignature],
    message_hash: &[u8; 32],
    via_registry: &SignerRegistry,
    chain_registry: &SignerRegistry,
    project_registry: Option<&SignerRegistry>,
    ix_sysvar_account: &AccountInfo,
) -> Result<ValidationResult> {
    // Input validation
    require!(
        !signatures.is_empty() && signatures.len() <= MAX_SIGNATURES_PER_MESSAGE,
        GatewayError::TooManySignatures
    );
    
    require!(
        signatures.len() >= MIN_SIGNATURES_REQUIRED,
        GatewayError::TooFewSignatures
    );
    
    validate_message_hash(message_hash)?;
    
    // Check that registries are enabled
    require!(via_registry.enabled, GatewayError::SignerRegistryDisabled);
    require!(chain_registry.enabled, GatewayError::SignerRegistryDisabled);
    
    if let Some(proj_registry) = project_registry {
        require!(proj_registry.enabled, GatewayError::SignerRegistryDisabled);
    }
    
    let mut validation_result = ValidationResult::new();
    let mut used_signers = Vec::new();
    
    // Validate each signature
    for signature in signatures {
        // Prevent signer reuse
        require!(
            !used_signers.contains(&signature.signer),
            GatewayError::DuplicateSigner
        );
        used_signers.push(signature.signer);
        
        // Verify Ed25519 signature
        let is_valid_signature = verify_ed25519_signature(
            &signature.signature,
            &signature.signer,
            message_hash,
            ix_sysvar_account,
        )?;
        
        if !is_valid_signature {
            msg!("Invalid Ed25519 signature from signer: {}", signature.signer);
            return Err(GatewayError::InvalidSignature.into());
        }
        
        // Ethereum-style implicit layer detection: check membership across all registries
        let is_via_signer = via_registry.is_signer(&signature.signer);
        let is_chain_signer = chain_registry.is_signer(&signature.signer);
        let is_project_signer = if let Some(proj_registry) = project_registry {
            proj_registry.is_signer(&signature.signer)
        } else {
            false
        };
        
        // Require signer to belong to at least one registry
        if !is_via_signer && !is_chain_signer && !is_project_signer {
            msg!(
                "Unauthorized signer {} - not found in any registry",
                signature.signer
            );
            return Err(GatewayError::UnauthorizedSigner.into());
        }
        
        // Increment counters based on registry memberships
        validation_result.increment_for_signer(is_via_signer, is_chain_signer, is_project_signer);
        
        msg!(
            "Valid signature from {} (VIA: {}, Chain: {}, Project: {})",
            signature.signer,
            is_via_signer,
            is_chain_signer,
            is_project_signer
        );
    }
    
    // Check threshold requirements for each layer
    validate_signature_thresholds(&validation_result, via_registry, chain_registry, project_registry)?;
    
    msg!(
        "Signature validation completed: VIA={}, Chain={}, Project={}, Total={}",
        validation_result.via_signatures,
        validation_result.chain_signatures,
        validation_result.project_signatures,
        validation_result.total_valid
    );
    
    Ok(validation_result)
}

/// Validate that signature thresholds are met for all required layers
fn validate_signature_thresholds(
    validation_result: &ValidationResult,
    via_registry: &SignerRegistry,
    chain_registry: &SignerRegistry,
    project_registry: Option<&SignerRegistry>,
) -> Result<()> {
    // VIA layer threshold
    require!(
        validation_result.via_signatures >= via_registry.required_signatures,
        GatewayError::InsufficientVIASignatures
    );
    
    // Chain layer threshold
    require!(
        validation_result.chain_signatures >= chain_registry.required_signatures,
        GatewayError::InsufficientChainSignatures
    );
    
    // Project layer threshold (if registry exists)
    if let Some(proj_registry) = project_registry {
        require!(
            validation_result.project_signatures >= proj_registry.required_signatures,
            GatewayError::InsufficientProjectSignatures
        );
    }
    
    Ok(())
}

/// Simplified signature validation for TX1 (create_tx_pda)
/// Only requires basic validation, full validation happens in TX2
pub fn validate_signatures_tx1(
    signatures: &[MessageSignature],
    message_hash: &[u8; 32],
    ix_sysvar_account: &AccountInfo,
) -> Result<()> {
    // Basic validation only for TX1
    require!(
        !signatures.is_empty() && signatures.len() <= MAX_SIGNATURES_PER_MESSAGE,
        GatewayError::TooManySignatures
    );
    
    validate_message_hash(message_hash)?;
    
    // Just verify that at least one signature is cryptographically valid
    let mut valid_signature_found = false;
    
    for signature in signatures {
        if verify_ed25519_signature(
            &signature.signature,
            &signature.signer,
            message_hash,
            ix_sysvar_account,
        )? {
            valid_signature_found = true;
            break;
        }
    }
    
    require!(valid_signature_found, GatewayError::InvalidSignature);
    
    msg!("TX1 signature validation passed with {} signatures", signatures.len());
    Ok(())
}

/// Helper function to create message signature struct
pub fn create_message_signature(
    signature_bytes: [u8; 64],
    signer_pubkey: Pubkey,
) -> MessageSignature {
    MessageSignature {
        signature: signature_bytes,
        signer: signer_pubkey,
    }
}