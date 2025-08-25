/// Constants for the Via Labs Message Gateway
pub const GATEWAY_SEED: &[u8] = b"gateway";
pub const COUNTER_SEED: &[u8] = b"counter";
pub const TX_SEED: &[u8] = b"tx";

/// Maximum sizes for DOS protection
pub const MAX_RECIPIENT_SIZE: usize = 64;
pub const MAX_SENDER_SIZE: usize = 64;
pub const MAX_ON_CHAIN_DATA_SIZE: usize = 1024;
pub const MAX_OFF_CHAIN_DATA_SIZE: usize = 1024;