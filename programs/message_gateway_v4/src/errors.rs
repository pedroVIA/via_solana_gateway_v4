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
}