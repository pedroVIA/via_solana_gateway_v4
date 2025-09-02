// Utility functions for Via Labs V4 Message Gateway decoders

// Simple base58 encode function
export function base58Encode(buffer: Buffer): string {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    let num = BigInt('0x' + buffer.toString('hex'));
    
    while (num > 0) {
        result = alphabet[Number(num % 58n)] + result;
        num = num / 58n;
    }
    
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
        result = '1' + result;
    }
    
    return result;
}

// Read u128 from buffer as little endian
export function readU128LE(buffer: Buffer, offset: number): bigint {
    let value = 0n;
    for (let i = 0; i < 16; i++) {
        value += BigInt(buffer[offset + i]) << BigInt(i * 8);
    }
    return value;
}

// Read Vec<u8> from buffer (4-byte length prefix + data)
export function readVecU8(buffer: Buffer, offset: number): {
    length: number;
    data: Buffer;
    nextOffset: number;
} {
    const length = buffer.readUInt32LE(offset);
    const data = buffer.subarray(offset + 4, offset + 4 + length);
    return {
        length,
        data,
        nextOffset: offset + 4 + length
    };
}

// Read Vec<Pubkey> from buffer (4-byte length prefix + 32-byte pubkeys)
export function readVecPubkey(buffer: Buffer, offset: number): {
    length: number;
    pubkeys: string[];
    nextOffset: number;
} {
    const length = buffer.readUInt32LE(offset);
    offset += 4;
    
    const pubkeys: string[] = [];
    for (let i = 0; i < length; i++) {
        const pubkey = buffer.subarray(offset, offset + 32);
        pubkeys.push(base58Encode(pubkey));
        offset += 32;
    }
    
    return {
        length,
        pubkeys,
        nextOffset: offset
    };
}

// Read MessageSignature from buffer (64-byte signature + 32-byte signer)
export function readMessageSignature(buffer: Buffer, offset: number): {
    signature: string;
    signer: string;
    nextOffset: number;
} {
    const signature = buffer.subarray(offset, offset + 64);
    const signer = buffer.subarray(offset + 64, offset + 96);
    
    return {
        signature: signature.toString('hex'),
        signer: base58Encode(signer),
        nextOffset: offset + 96
    };
}

// Read Vec<MessageSignature> from buffer
export function readVecMessageSignature(buffer: Buffer, offset: number): {
    length: number;
    signatures: Array<{ signature: string; signer: string }>;
    nextOffset: number;
} {
    const length = buffer.readUInt32LE(offset);
    offset += 4;
    
    const signatures: Array<{ signature: string; signer: string }> = [];
    for (let i = 0; i < length; i++) {
        const sig = readMessageSignature(buffer, offset);
        signatures.push({
            signature: sig.signature,
            signer: sig.signer
        });
        offset = sig.nextOffset;
    }
    
    return {
        length,
        signatures,
        nextOffset: offset
    };
}

// SignerRegistryType enum decoder
export function decodeSignerRegistryType(value: number): string {
    switch (value) {
        case 0: return 'VIA';
        case 1: return 'Chain';
        case 2: return 'Project';
        default: return `Unknown(${value})`;
    }
}

// Chain ID to name mapping
export function getChainName(chainId: bigint | string): string {
    switch (chainId.toString()) {
        case '1': return 'Solana Testnet';
        case '2': return 'Ethereum';
        case '3': return 'Polygon';
        default: return `Chain ${chainId}`;
    }
}