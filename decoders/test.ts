// Via Labs V4 Message Gateway - Decoder Test
import { decode, decodeAsEvent, decodeAndPrint, prettyPrint } from './index';

// Your original SendRequested event data
const SEND_REQUESTED_DATA = "2RiEmgRsd3q7JwMAAAAAAAAAAAAAAAAAQA3TqkkppimtLH6I5o5YOgwxk9Sdk4R+bPqAVNnOj5kUAAAAdC01zDxsa0j4P0w/bJfYwrYasrQCAAAAAAAAABIAAABIZWxsbyBmcm9tIFNvbGFuYSEBAA==";

function runTests() {
    console.log('🚀 VIA LABS V4 MESSAGE GATEWAY DECODER TESTS\n');
    
    // Test 1: Auto-detect and decode your original data
    console.log('📋 Test 1: Auto-detect SendRequested Event');
    console.log('=' .repeat(50));
    const result1 = decode(SEND_REQUESTED_DATA);
    console.log(prettyPrint(result1));
    console.log('\n');
    
    // Test 2: Force decode as event
    console.log('📋 Test 2: Force decode as Event');
    console.log('=' .repeat(50));
    const result2 = decodeAsEvent(SEND_REQUESTED_DATA);
    console.log(JSON.stringify(result2, null, 2));
    console.log('\n');
    
    // Test 3: CLI-style output
    console.log('📋 Test 3: CLI-style output');
    console.log('=' .repeat(50));
    decodeAndPrint(SEND_REQUESTED_DATA);
    console.log('\n');
    
    // Test 4: Error handling with invalid data
    console.log('📋 Test 4: Error handling');
    console.log('=' .repeat(50));
    const invalidData = "invalid";
    const result4 = decode(invalidData);
    console.log(prettyPrint(result4));
    console.log('\n');
    
    console.log('✅ All tests completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
    runTests();
}