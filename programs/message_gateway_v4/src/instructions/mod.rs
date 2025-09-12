pub mod admin;
pub mod create_tx_pda;
pub mod initialize;
pub mod initialize_counter;
pub mod process_message;
pub mod send_message;
pub mod signer_registry;

// Public re-exports (Context structs needed by external code)
pub use admin::SetSystemEnabled;
pub use create_tx_pda::CreateTxPda;
pub use initialize::InitializeGateway;
pub use initialize_counter::InitializeCounter;
pub use process_message::ProcessMessage;
pub use send_message::SendMessage;
pub use signer_registry::{
    InitializeSignerRegistry,
    UpdateSigners,
    AddSigner,
    RemoveSigner,
    UpdateThreshold,
    SetRegistryEnabled,
};

// Crate-internal re-exports (client account symbols needed by #[program] macro)
pub(crate) use admin::__client_accounts_set_system_enabled;
pub(crate) use create_tx_pda::*;
pub(crate) use initialize::*;
pub(crate) use initialize_counter::*;
pub(crate) use process_message::*;
pub(crate) use send_message::*;
pub(crate) use signer_registry::*;