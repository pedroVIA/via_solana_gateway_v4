# Via Labs V4 Message Gateway Decoders

TypeScript decoders for Via Labs V4 Message Gateway Program Data (instructions and events).

## Overview

This decoder library allows you to parse base64-encoded Program Data from Solana transactions involving the Via Labs V4 Message Gateway. It supports both instruction data and event data.

## Files

- **`index.ts`** - Main decoder interface with auto-detection
- **`instructions.ts`** - All instruction decoders with type definitions
- **`events.ts`** - All event decoders with type definitions
- **`utils.ts`** - Shared utility functions (base58, serialization helpers)
- **`test.ts`** - Test file demonstrating usage
- **`README.md`** - This documentation

## Quick Start

```typescript
import { decode, decodeAndPrint } from './decoders';

// Your Program Data (base64)
const programData = "2RiEmgRsd3q7JwMAAAAAAAAAAAAAAAAAQA3TqkkppimtLH6I5o5YOgwxk9Sdk4R+bPqAVNnOj5kUAAAAdC01zDxsa0j4P0w/bJfYwrYasrQCAAAAAAAAABIAAABIZWxsbyBmcm9tIFNvbGFuYSEBAA==";

// Auto-detect and decode
const result = decode(programData);
console.log(result);

// Or use CLI-style output
decodeAndPrint(programData);
```

## Supported Instructions

| Instruction | Description |
|-------------|-------------|
| `initialize_gateway` | Initialize gateway for a specific chain |
| `send_message` | Send a cross-chain message |
| `create_tx_pda` | TX1: Create TxId PDA for replay protection |
| `process_message` | TX2: Process message with atomic PDA closure |
| `set_system_enabled` | Update system enabled status (admin) |
| `initialize_signer_registry` | Initialize a signer registry |
| `update_signers` | Update signers in registry |
| `add_signer` | Add signer to registry |
| `remove_signer` | Remove signer from registry |
| `update_threshold` | Update signature threshold |
| `set_registry_enabled` | Enable/disable signer registry |

## Supported Events

| Event | Description |
|-------|-------------|
| `send_requested` | Emitted when a message is sent |
| `tx_pda_created` | Emitted when TxId PDA is created (TX1) |
| `message_processed` | Emitted when message is processed (TX2) |
| `system_status_changed` | Emitted when system status changes |

## API Reference

### Main Functions

#### `decode(base64Data: string): DecodedData`
Auto-detects and decodes instruction or event data.

#### `decodeAsInstruction(base64Data: string): DecodedInstruction`
Forces decoding as instruction data.

#### `decodeAsEvent(base64Data: string): DecodedEvent`
Forces decoding as event data.

#### `prettyPrint(decoded: DecodedData): string`
Formats decoded data as a readable string.

#### `decodeAndPrint(base64Data: string): void`
CLI-style decoder with formatted output.

### Type Definitions

All decoded results include full TypeScript type definitions with proper field types and union types for different instruction/event variants.

## Example: SendRequested Event

```typescript
import { decodeAsEvent } from './decoders';

const data = "2RiEmgRsd3q7JwMAAAAAAAAAAAAAAAAAQA3TqkkppimtLH6I5o5YOgwxk9Sdk4R+bPqAVNnOj5kUAAAAdC01zDxsa0j4P0w/bJfYwrYasrQCAAAAAAAAABIAAABIZWxsbyBmcm9tIFNvbGFuYSEBAA==";

const decoded = decodeAsEvent(data);
// Result:
// {
//   "event": "send_requested",
//   "txId": "206779",
//   "sender": "5K3KdPvYkVLVcuvV9TpNFv6h62rxX7vGEnmRsCQM7ecg",
//   "recipient": "742d35cc3c6c6b48f83f4c3f6c97d8c2b61ab2b4",
//   "destChainId": "2",
//   "destChainName": "Ethereum",
//   "chainData": "Hello from Solana!",
//   "confirmations": 1
// }
```

## Running Tests

```bash
# From the decoders directory
yarn ts-node test.ts
```

## Chain ID Mapping

- `1` - Solana Testnet
- `2` - Ethereum  
- `3` - Polygon

## Signer Registry Types

- `0` - VIA (Via Labs core signers)
- `1` - Chain (Chain-specific validators)  
- `2` - Project (Application-specific signers)

## Error Handling

The decoders include comprehensive error handling:
- Buffer length validation
- Discriminator matching
- Field boundary checks
- Graceful fallback for unknown data

Unknown or invalid data returns structured error information including the raw hex data for debugging.

## Contributing

When adding new instructions or events:
1. Add discriminator to the appropriate constants
2. Create decoder function following existing patterns
3. Add TypeScript interface for the result
4. Update the main switch statement
5. Add tests demonstrating the new functionality