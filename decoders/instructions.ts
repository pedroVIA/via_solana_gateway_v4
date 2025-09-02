// Via Labs V4 Message Gateway - Instruction Decoders
import { base58Encode, readU128LE, readVecU8, readVecPubkey, readVecMessageSignature, decodeSignerRegistryType, getChainName } from './utils';

// Instruction discriminators (8 bytes each)
export const INSTRUCTION_DISCRIMINATORS = {
    'initialize_gateway': '175175a0c5c87c47',
    'send_message': 'd918849a046c777a', 
    'create_tx_pda': 'a42ba5e4b0d17af1',
    'process_message': '93a64b5d1d5d8b77',
    'set_system_enabled': '4e7d7c6b5b3b3c1a',
    'initialize_signer_registry': '8d5d8b771d5d8b77',
    'update_signers': '9b3b3c1a7c6b5b3b',
    'add_signer': 'b0d17af1a42ba5e4',
    'remove_signer': '5d8b777c6b5b3b3c',
    'update_threshold': '1d5d8b775d8b777c',
    'set_registry_enabled': '7c6b5b3bb0d17af1'
};

// Reverse lookup for discriminator to instruction name
export const DISCRIMINATOR_TO_INSTRUCTION: Record<string, string> = {};
for (const [name, disc] of Object.entries(INSTRUCTION_DISCRIMINATORS)) {
    DISCRIMINATOR_TO_INSTRUCTION[disc] = name;
}

// Type definitions for decoded instructions
export interface InitializeGatewayDecoded {
    instruction: 'initialize_gateway';
    chainId: string;
    chainName: string;
}

export interface SendMessageDecoded {
    instruction: 'send_message';
    txId: string;
    recipient: string;
    recipientLength: number;
    destChainId: string;
    destChainName: string;
    chainData: string;
    chainDataHex: string;
    confirmations: number;
}

export interface CreateTxPdaDecoded {
    instruction: 'create_tx_pda';
    txId: string;
    sourceChainId: string;
    sourceChainName: string;
    destChainId: string;
    destChainName: string;
    sender: string;
    senderLength: number;
    recipient: string;
    recipientLength: number;
    onChainData: string;
    onChainDataHex: string;
    offChainData: string;
    offChainDataHex: string;
    signatures: Array<{ signature: string; signer: string }>;
    signatureCount: number;
}

export interface ProcessMessageDecoded {
    instruction: 'process_message';
    txId: string;
    sourceChainId: string;
    sourceChainName: string;
    destChainId: string;
    destChainName: string;
    sender: string;
    senderLength: number;
    recipient: string;
    recipientLength: number;
    onChainData: string;
    onChainDataHex: string;
    offChainData: string;
    offChainDataHex: string;
    signatures: Array<{ signature: string; signer: string }>;
    signatureCount: number;
}

export interface SetSystemEnabledDecoded {
    instruction: 'set_system_enabled';
    enabled: boolean;
}

export interface InitializeSignerRegistryDecoded {
    instruction: 'initialize_signer_registry';
    registryType: string;
    registryTypeValue: number;
    chainId: string;
    chainName: string;
    signers: string[];
    signerCount: number;
    requiredSignatures: number;
}

export interface UpdateSignersDecoded {
    instruction: 'update_signers';
    registryType: string;
    registryTypeValue: number;
    chainId: string;
    chainName: string;
    newSigners: string[];
    signerCount: number;
    newRequiredSignatures: number;
}

export interface AddSignerDecoded {
    instruction: 'add_signer';
    registryType: string;
    registryTypeValue: number;
    chainId: string;
    chainName: string;
    newSigner: string;
}

export interface RemoveSignerDecoded {
    instruction: 'remove_signer';
    registryType: string;
    registryTypeValue: number;
    chainId: string;
    chainName: string;
    signerToRemove: string;
}

export interface UpdateThresholdDecoded {
    instruction: 'update_threshold';
    registryType: string;
    registryTypeValue: number;
    chainId: string;
    chainName: string;
    newThreshold: number;
}

export interface SetRegistryEnabledDecoded {
    instruction: 'set_registry_enabled';
    registryType: string;
    registryTypeValue: number;
    chainId: string;
    chainName: string;
    enabled: boolean;
}

export interface UnknownInstructionDecoded {
    instruction: 'unknown';
    discriminator: string;
    rawHex: string;
}

export interface ErrorDecoded {
    instruction: string;
    error: string;
    discriminator: string;
    rawHex: string;
}

export type DecodedInstruction = 
    | InitializeGatewayDecoded
    | SendMessageDecoded
    | CreateTxPdaDecoded
    | ProcessMessageDecoded
    | SetSystemEnabledDecoded
    | InitializeSignerRegistryDecoded
    | UpdateSignersDecoded
    | AddSignerDecoded
    | RemoveSignerDecoded
    | UpdateThresholdDecoded
    | SetRegistryEnabledDecoded
    | UnknownInstructionDecoded
    | ErrorDecoded;

function decodeInitializeGateway(buffer: Buffer): InitializeGatewayDecoded {
    let offset = 8; // Skip discriminator
    
    // chain_id: u64
    const chainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    return {
        instruction: 'initialize_gateway',
        chainId: chainId.toString(),
        chainName: getChainName(chainId)
    };
}

function decodeSendMessage(buffer: Buffer): SendMessageDecoded {
    let offset = 8; // Skip discriminator
    
    // tx_id: u128
    const txId = readU128LE(buffer, offset);
    offset += 16;
    
    // recipient: Vec<u8>
    const recipient = readVecU8(buffer, offset);
    offset = recipient.nextOffset;
    
    // dest_chain_id: u64
    const destChainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // chain_data: Vec<u8>
    const chainData = readVecU8(buffer, offset);
    offset = chainData.nextOffset;
    
    // confirmations: u16
    const confirmations = buffer.readUInt16LE(offset);
    offset += 2;
    
    return {
        instruction: 'send_message',
        txId: txId.toString(),
        recipient: recipient.length === 32 ? base58Encode(recipient.data) : recipient.data.toString('hex'),
        recipientLength: recipient.length,
        destChainId: destChainId.toString(),
        destChainName: getChainName(destChainId),
        chainData: chainData.data.toString('utf8'),
        chainDataHex: chainData.data.toString('hex'),
        confirmations
    };
}

function decodeCreateTxPda(buffer: Buffer): CreateTxPdaDecoded {
    let offset = 8; // Skip discriminator
    
    // tx_id: u128
    const txId = readU128LE(buffer, offset);
    offset += 16;
    
    // source_chain_id: u64
    const sourceChainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // dest_chain_id: u64
    const destChainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // sender: Vec<u8>
    const sender = readVecU8(buffer, offset);
    offset = sender.nextOffset;
    
    // recipient: Vec<u8>
    const recipient = readVecU8(buffer, offset);
    offset = recipient.nextOffset;
    
    // on_chain_data: Vec<u8>
    const onChainData = readVecU8(buffer, offset);
    offset = onChainData.nextOffset;
    
    // off_chain_data: Vec<u8>
    const offChainData = readVecU8(buffer, offset);
    offset = offChainData.nextOffset;
    
    // signatures: Vec<MessageSignature>
    const signatures = readVecMessageSignature(buffer, offset);
    offset = signatures.nextOffset;
    
    return {
        instruction: 'create_tx_pda',
        txId: txId.toString(),
        sourceChainId: sourceChainId.toString(),
        sourceChainName: getChainName(sourceChainId),
        destChainId: destChainId.toString(),
        destChainName: getChainName(destChainId),
        sender: sender.length === 32 ? base58Encode(sender.data) : sender.data.toString('hex'),
        senderLength: sender.length,
        recipient: recipient.length === 32 ? base58Encode(recipient.data) : recipient.data.toString('hex'),
        recipientLength: recipient.length,
        onChainData: onChainData.data.toString('utf8'),
        onChainDataHex: onChainData.data.toString('hex'),
        offChainData: offChainData.data.toString('utf8'),
        offChainDataHex: offChainData.data.toString('hex'),
        signatures: signatures.signatures,
        signatureCount: signatures.length
    };
}

function decodeProcessMessage(buffer: Buffer): ProcessMessageDecoded {
    // Same structure as create_tx_pda
    const result = decodeCreateTxPda(buffer) as any;
    result.instruction = 'process_message';
    return result;
}

function decodeSetSystemEnabled(buffer: Buffer): SetSystemEnabledDecoded {
    let offset = 8; // Skip discriminator
    
    // enabled: bool
    const enabled = buffer[offset] !== 0;
    offset += 1;
    
    return {
        instruction: 'set_system_enabled',
        enabled
    };
}

function decodeInitializeSignerRegistry(buffer: Buffer): InitializeSignerRegistryDecoded {
    let offset = 8; // Skip discriminator
    
    // registry_type: SignerRegistryType (u8)
    const registryType = buffer[offset];
    offset += 1;
    
    // chain_id: u64
    const chainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // initial_signers: Vec<Pubkey>
    const signers = readVecPubkey(buffer, offset);
    offset = signers.nextOffset;
    
    // required_signatures: u8
    const requiredSignatures = buffer[offset];
    offset += 1;
    
    return {
        instruction: 'initialize_signer_registry',
        registryType: decodeSignerRegistryType(registryType),
        registryTypeValue: registryType,
        chainId: chainId.toString(),
        chainName: getChainName(chainId),
        signers: signers.pubkeys,
        signerCount: signers.length,
        requiredSignatures
    };
}

function decodeUpdateSigners(buffer: Buffer): UpdateSignersDecoded {
    let offset = 8; // Skip discriminator
    
    // registry_type: SignerRegistryType (u8)
    const registryType = buffer[offset];
    offset += 1;
    
    // chain_id: u64
    const chainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // new_signers: Vec<Pubkey>
    const signers = readVecPubkey(buffer, offset);
    offset = signers.nextOffset;
    
    // new_required_signatures: u8
    const requiredSignatures = buffer[offset];
    offset += 1;
    
    return {
        instruction: 'update_signers',
        registryType: decodeSignerRegistryType(registryType),
        registryTypeValue: registryType,
        chainId: chainId.toString(),
        chainName: getChainName(chainId),
        newSigners: signers.pubkeys,
        signerCount: signers.length,
        newRequiredSignatures: requiredSignatures
    };
}

function decodeAddSigner(buffer: Buffer): AddSignerDecoded {
    let offset = 8; // Skip discriminator
    
    // registry_type: SignerRegistryType (u8)
    const registryType = buffer[offset];
    offset += 1;
    
    // chain_id: u64
    const chainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // new_signer: Pubkey (32 bytes)
    const newSigner = buffer.subarray(offset, offset + 32);
    offset += 32;
    
    return {
        instruction: 'add_signer',
        registryType: decodeSignerRegistryType(registryType),
        registryTypeValue: registryType,
        chainId: chainId.toString(),
        chainName: getChainName(chainId),
        newSigner: base58Encode(newSigner)
    };
}

function decodeRemoveSigner(buffer: Buffer): RemoveSignerDecoded {
    let offset = 8; // Skip discriminator
    
    // registry_type: SignerRegistryType (u8)
    const registryType = buffer[offset];
    offset += 1;
    
    // chain_id: u64
    const chainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // signer_to_remove: Pubkey (32 bytes)
    const signerToRemove = buffer.subarray(offset, offset + 32);
    offset += 32;
    
    return {
        instruction: 'remove_signer',
        registryType: decodeSignerRegistryType(registryType),
        registryTypeValue: registryType,
        chainId: chainId.toString(),
        chainName: getChainName(chainId),
        signerToRemove: base58Encode(signerToRemove)
    };
}

function decodeUpdateThreshold(buffer: Buffer): UpdateThresholdDecoded {
    let offset = 8; // Skip discriminator
    
    // registry_type: SignerRegistryType (u8)
    const registryType = buffer[offset];
    offset += 1;
    
    // chain_id: u64
    const chainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // new_threshold: u8
    const newThreshold = buffer[offset];
    offset += 1;
    
    return {
        instruction: 'update_threshold',
        registryType: decodeSignerRegistryType(registryType),
        registryTypeValue: registryType,
        chainId: chainId.toString(),
        chainName: getChainName(chainId),
        newThreshold
    };
}

function decodeSetRegistryEnabled(buffer: Buffer): SetRegistryEnabledDecoded {
    let offset = 8; // Skip discriminator
    
    // registry_type: SignerRegistryType (u8)
    const registryType = buffer[offset];
    offset += 1;
    
    // chain_id: u64
    const chainId = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // enabled: bool
    const enabled = buffer[offset] !== 0;
    offset += 1;
    
    return {
        instruction: 'set_registry_enabled',
        registryType: decodeSignerRegistryType(registryType),
        registryTypeValue: registryType,
        chainId: chainId.toString(),
        chainName: getChainName(chainId),
        enabled
    };
}

// Main decoder function
export function decodeInstruction(base64Data: string): DecodedInstruction {
    const buffer = Buffer.from(base64Data, 'base64');
    
    if (buffer.length < 8) {
        throw new Error('Buffer too small for instruction discriminator');
    }
    
    const discriminator = buffer.subarray(0, 8).toString('hex');
    const instructionName = DISCRIMINATOR_TO_INSTRUCTION[discriminator];
    
    if (!instructionName) {
        return {
            instruction: 'unknown',
            discriminator,
            rawHex: buffer.toString('hex')
        };
    }
    
    try {
        switch (instructionName) {
            case 'initialize_gateway':
                return decodeInitializeGateway(buffer);
            case 'send_message':
                return decodeSendMessage(buffer);
            case 'create_tx_pda':
                return decodeCreateTxPda(buffer);
            case 'process_message':
                return decodeProcessMessage(buffer);
            case 'set_system_enabled':
                return decodeSetSystemEnabled(buffer);
            case 'initialize_signer_registry':
                return decodeInitializeSignerRegistry(buffer);
            case 'update_signers':
                return decodeUpdateSigners(buffer);
            case 'add_signer':
                return decodeAddSigner(buffer);
            case 'remove_signer':
                return decodeRemoveSigner(buffer);
            case 'update_threshold':
                return decodeUpdateThreshold(buffer);
            case 'set_registry_enabled':
                return decodeSetRegistryEnabled(buffer);
            default:
                throw new Error(`Decoder not implemented for ${instructionName}`);
        }
    } catch (error) {
        return {
            instruction: instructionName,
            error: (error as Error).message,
            discriminator,
            rawHex: buffer.toString('hex')
        };
    }
}