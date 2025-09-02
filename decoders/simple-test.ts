// Simple test of the SendRequested event decoder
import { decodeAsEvent } from './events';

// Your original SendRequested event data
const SEND_REQUESTED_DATA = "2RiEmgRsd3q7JwMAAAAAAAAAAAAAAAAAQA3TqkkppimtLH6I5o5YOgwxk9Sdk4R+bPqAVNnOj5kUAAAAdC01zDxsa0j4P0w/bJfYwrYasrQCAAAAAAAAABIAAABIZWxsbyBmcm9tIFNvbGFuYSEBAA==";

console.log('🚀 Via Labs V4 SendRequested Event Decoder Test\n');

try {
    const decoded = decodeAsEvent(SEND_REQUESTED_DATA);
    
    console.log('=== DECODED SEND REQUESTED EVENT ===');
    console.log('Event Type:', decoded.event);
    console.log('TX ID:', (decoded as any).txId);
    console.log('Sender:', (decoded as any).sender);
    console.log('Recipient:', (decoded as any).recipient);
    console.log('Destination Chain:', (decoded as any).destChainName);
    console.log('Message:', `"${(decoded as any).chainData}"`);
    console.log('Confirmations:', (decoded as any).confirmations);
    
    console.log('\n=== FULL JSON OUTPUT ===');
    console.log(JSON.stringify(decoded, null, 2));
    
} catch (error) {
    console.error('Decode error:', error);
}