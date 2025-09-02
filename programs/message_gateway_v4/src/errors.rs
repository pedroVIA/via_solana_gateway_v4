use anchor_lang::prelude::*;

#[error_code]
pub enum GatewayError {
    #[msg("System is disabled")]
    SystemDisabled,
    
    #[msg("Empty recipient address")]
    EmptyRecipient,
    
    #[msg("Empty chain data")]
    EmptyChainData,
    
    #[msg("Invalid destination chain")]
    InvalidDestChain,
    
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    
    #[msg("Invalid transaction ID")]
    InvalidTxId,
    
    #[msg("Sender address too long")]
    SenderTooLong,
    
    #[msg("Recipient address too long")]
    RecipientTooLong,
    
    #[msg("On-chain data too large")]
    OnChainDataTooLarge,
    
    #[msg("Off-chain data too large")]
    OffChainDataTooLarge,
    
    // Signature validation errors
    #[msg("Invalid signature provided")]
    InvalidSignature,
    
    #[msg("Insufficient signatures for validation")]
    InsufficientSignatures,
    
    #[msg("Unauthorized signer")]
    UnauthorizedSigner,
    
    #[msg("Invalid message hash")]
    InvalidMessageHash,
    
    #[msg("VIA signature threshold not met")]
    InsufficientVIASignatures,
    
    #[msg("Chain signature threshold not met")]
    InsufficientChainSignatures,
    
    #[msg("Project signature threshold not met")]
    InsufficientProjectSignatures,
    
    #[msg("Duplicate signer detected")]
    DuplicateSigner,
    
    #[msg("Too many signatures provided")]
    TooManySignatures,
    
    #[msg("Too few signatures provided")]
    TooFewSignatures,
    
    #[msg("Invalid signer registry type")]
    InvalidSignerRegistryType,
    
    #[msg("Signer registry is disabled")]
    SignerRegistryDisabled,
    
    #[msg("Invalid threshold configuration")]
    InvalidThreshold,
    
    #[msg("Threshold too high for signer count")]
    ThresholdTooHigh,
    
    #[msg("Ed25519 signature verification failed")]
    Ed25519VerificationFailed,
    
    #[msg("Message hash mismatch")]
    MessageHashMismatch,
    
    #[msg("Cross-chain hash generation failed")]
    HashGenerationFailed,
    
    #[msg("Signature format invalid")]
    InvalidSignatureFormat,
}