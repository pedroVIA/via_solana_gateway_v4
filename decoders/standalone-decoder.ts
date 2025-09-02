// Standalone Via Labs V4 SendRequested Event Decoder
// Self-contained with all utilities included

// Your original SendRequested event data
const SEND_REQUESTED_DATA = "2RiEmgRsd3q7JwMAAAAAAAAAAAAAAAAAQA3TqkkppimtLH6I5o5YOgwxk9Sdk4R+bPqAVNnOj5kUAAAAdC01zDxsa0j4P0w/bJfYwrYasrQCAAAAAAAAABIAAABIZWxsbyBmcm9tIFNvbGFuYSEBAA==";

// Simple base58 encode function
function base58Encode(buffer: Buffer): string {
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
function readU128LE(buffer: Buffer, offset: number): bigint {
    let value = 0n;
    for (let i = 0; i < 16; i++) {
        value += BigInt(buffer[offset + i]) << BigInt(i * 8);
    }
    return value;
}

// Read Vec<u8> from buffer (4-byte length prefix + data)
function readVecU8(buffer: Buffer, offset: number) {
    const length = buffer.readUInt32LE(offset);
    const data = buffer.subarray(offset + 4, offset + 4 + length);
    return {
        length,
        data,
        nextOffset: offset + 4 + length
    };
}

// Chain ID to name mapping
function getChainName(chainId: bigint | string): string {
    switch (chainId.toString()) {
        case '1': return 'Solana Testnet';
        case '2': return 'Ethereum';
        case '3': return 'Polygon';
        default: return `Chain ${chainId}`;
    }
}

function decodeSendRequested(buffer: Buffer) {
    let offset = 8; // Skip discriminator
    
    // tx_id: u128
    const txId = readU128LE(buffer, offset);
    offset += 16;
    
    // sender: [u8; 32] (fixed array)
    const sender = buffer.subarray(offset, offset + 32);
    offset += 32;
    
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
        event: 'send_requested',
        txId: txId.toString(),
        sender: base58Encode(sender),
        recipient: recipient.length === 32 ? base58Encode(recipient.data) : recipient.data.toString('hex'),
        recipientLength: recipient.length,
        destChainId: destChainId.toString(),
        destChainName: getChainName(destChainId),
        chainData: chainData.data.toString('utf8'),
        chainDataHex: chainData.data.toString('hex'),
        confirmations
    };
}

console.log('🚀 Via Labs V4 SendRequested Event Decoder\n');

try {
    const buffer = Buffer.from(SEND_REQUESTED_DATA, 'base64');
    const discriminator = buffer.subarray(0, 8).toString('hex');
    
    console.log('Raw Data Length:', buffer.length, 'bytes');
    console.log('Discriminator:', discriminator);
    console.log();
    
    const decoded = decodeSendRequested(buffer);
    
    console.log('=== DECODED SEND REQUESTED EVENT ===');
    console.log('Event Type:', decoded.event);
    console.log('TX ID:', decoded.txId);
    console.log('Sender:', decoded.sender);
    console.log('Recipient:', decoded.recipient);
    console.log('Recipient Type:', decoded.recipientLength === 32 ? 'Solana Pubkey' : `${decoded.recipientLength}-byte address`);
    console.log('Destination Chain:', `${decoded.destChainId} (${decoded.destChainName})`);
    console.log('Message:', `"${decoded.chainData}"`);
    console.log('Confirmations:', decoded.confirmations);
    
    console.log('\n=== FULL DECODED DATA ===');
    console.log(JSON.stringify(decoded, null, 2));
    
} catch (error) {
    console.error('Decode error:', error);
}