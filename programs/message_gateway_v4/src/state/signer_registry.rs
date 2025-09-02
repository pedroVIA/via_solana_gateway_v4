use anchor_lang::prelude::*;

/// Signer registry for managing authorized signers in three-layer security model
#[account]
pub struct SignerRegistry {
    /// Type of registry (VIA, Chain, or Project)
    pub registry_type: SignerRegistryType,
    
    /// Authority that can modify this registry
    pub authority: Pubkey,
    
    /// List of authorized signer public keys
    pub signers: Vec<Pubkey>,
    
    /// Required number of signatures for validation
    pub required_signatures: u8,
    
    /// Chain ID this registry is associated with
    pub chain_id: u64,
    
    /// Whether this registry is active
    pub enabled: bool,
    
    /// PDA bump seed
    pub bump: u8,
}

impl SignerRegistry {
    /// Calculate the space needed for this account
    /// Base size + (32 bytes per signer)
    pub fn space(max_signers: usize) -> usize {
        8 +                         // discriminator
        1 +                         // registry_type
        32 +                        // authority
        4 + (32 * max_signers) +    // signers vec
        1 +                         // required_signatures
        8 +                         // chain_id
        1 +                         // enabled
        1                           // bump
    }
    
    /// Default maximum signers per registry
    pub const DEFAULT_MAX_SIGNERS: usize = 10;
    
    /// Minimum required signatures
    pub const MIN_REQUIRED_SIGNATURES: u8 = 1;
    
    /// Check if a signer is authorized
    pub fn is_signer(&self, signer: &Pubkey) -> bool {
        self.enabled && self.signers.contains(signer)
    }
    
    /// Validate threshold requirements
    pub fn validate_threshold(&self) -> Result<()> {
        require!(
            self.required_signatures > 0,
            crate::errors::GatewayError::InvalidThreshold
        );
        require!(
            self.required_signatures <= self.signers.len() as u8,
            crate::errors::GatewayError::ThresholdTooHigh
        );
        Ok(())
    }
}

/// Type of signer registry for three-layer security
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum SignerRegistryType {
    /// Via Labs core signers - highest authority level
    VIA,
    /// Chain-specific validators - chain security level
    Chain,
    /// Project-specific signers - application level
    Project,
}

impl SignerRegistryType {
    /// Get discriminant value for PDA seeds
    pub fn discriminant(&self) -> u8 {
        match self {
            SignerRegistryType::VIA => 0,
            SignerRegistryType::Chain => 1,
            SignerRegistryType::Project => 2,
        }
    }
    
    /// Convert from discriminant value
    pub fn from_discriminant(value: u8) -> Option<Self> {
        match value {
            0 => Some(SignerRegistryType::VIA),
            1 => Some(SignerRegistryType::Chain),
            2 => Some(SignerRegistryType::Project),
            _ => None,
        }
    }
}

/// Message signature - Ethereum-style simple format
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MessageSignature {
    /// Ed25519 signature (64 bytes)
    pub signature: [u8; 64],
    
    /// Signer public key - layer determined by registry membership
    pub signer: Pubkey,
}

impl MessageSignature {
    pub const SIZE: usize = 64 + 32;  // signature + pubkey
}

/// Security layer for signature validation
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum SignerLayer {
    /// Via Labs layer
    VIA,
    /// Chain validator layer
    Chain,
    /// Project application layer
    Project,
}

impl SignerLayer {
    /// Convert to registry type for lookup
    pub fn to_registry_type(&self) -> SignerRegistryType {
        match self {
            SignerLayer::VIA => SignerRegistryType::VIA,
            SignerLayer::Chain => SignerRegistryType::Chain,
            SignerLayer::Project => SignerRegistryType::Project,
        }
    }
}

/// Signature validation result
#[derive(Debug)]
pub struct ValidationResult {
    pub via_signatures: u8,
    pub chain_signatures: u8,
    pub project_signatures: u8,
    pub total_valid: u8,
}

impl ValidationResult {
    pub fn new() -> Self {
        Self {
            via_signatures: 0,
            chain_signatures: 0,
            project_signatures: 0,
            total_valid: 0,
        }
    }
    
    /// Increment counters based on which registries the signer belongs to
    pub fn increment_for_signer(&mut self, is_via: bool, is_chain: bool, is_project: bool) {
        if is_via {
            self.via_signatures += 1;
        }
        if is_chain {
            self.chain_signatures += 1;
        }
        if is_project {
            self.project_signatures += 1;
        }
        // Only increment total if signer belongs to at least one registry
        if is_via || is_chain || is_project {
            self.total_valid += 1;
        }
    }
}