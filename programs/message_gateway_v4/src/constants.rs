/// Constants for the Via Labs Message Gateway
pub const GATEWAY_SEED: &[u8] = b"gateway";
pub const COUNTER_SEED: &[u8] = b"counter";
pub const TX_SEED: &[u8] = b"tx";
pub const SIGNER_REGISTRY_SEED: &[u8] = b"signer_registry";

/// Maximum sizes for DOS protection
pub const MAX_RECIPIENT_SIZE: usize = 64;
pub const MAX_SENDER_SIZE: usize = 64;
pub const MAX_ON_CHAIN_DATA_SIZE: usize = 1024;
pub const MAX_OFF_CHAIN_DATA_SIZE: usize = 1024;

/// Signature validation constants
pub const MAX_SIGNATURES_PER_MESSAGE: usize = 8;
pub const MIN_SIGNATURES_REQUIRED: usize = 2;
pub const ED25519_SIGNATURE_SIZE: usize = 64;
pub const ED25519_PUBKEY_SIZE: usize = 32;

/// Signer registry constants
pub const MAX_SIGNERS_PER_REGISTRY: usize = 10;
pub const MIN_THRESHOLD: u8 = 1;