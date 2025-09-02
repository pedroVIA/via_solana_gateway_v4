// Via Labs V4 Message Gateway - Main Decoder Interface
import { decodeInstruction, DecodedInstruction, INSTRUCTION_DISCRIMINATORS } from './instructions';
import { decodeEvent, DecodedEvent, EVENT_DISCRIMINATORS, isLikelyEvent } from './events';

export * from './utils';
export * from './instructions';
export * from './events';

// Combined decoder result
export type DecodedData = {
    type: 'instruction';
    data: DecodedInstruction;
} | {
    type: 'event';
    data: DecodedEvent;
} | {
    type: 'unknown';
    discriminator: string;
    rawHex: string;
};

/**
 * Main decoder function that automatically detects and decodes instructions or events
 * @param base64Data - Base64 encoded program data
 * @returns Decoded instruction or event data
 */
export function decode(base64Data: string): DecodedData {
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        
        if (buffer.length < 8) {
            throw new Error('Buffer too small for discriminator');
        }
        
        const discriminator = buffer.subarray(0, 8).toString('hex');
        
        // Try to determine if this is an event or instruction
        if (isLikelyEvent(base64Data)) {
            const eventResult = decodeEvent(base64Data);
            return {
                type: 'event',
                data: eventResult
            };
        } else {
            // Try to decode as instruction first
            const instructionResult = decodeInstruction(base64Data);
            if (instructionResult.instruction !== 'unknown') {
                return {
                    type: 'instruction',
                    data: instructionResult
                };
            }
            
            // If instruction decoding failed, try event
            const eventResult = decodeEvent(base64Data);
            if (eventResult.event !== 'unknown') {
                return {
                    type: 'event',
                    data: eventResult
                };
            }
        }
        
        // If both failed, return unknown
        return {
            type: 'unknown',
            discriminator,
            rawHex: buffer.toString('hex')
        };
        
    } catch (error) {
        const buffer = Buffer.from(base64Data, 'base64');
        return {
            type: 'unknown',
            discriminator: buffer.length >= 8 ? buffer.subarray(0, 8).toString('hex') : 'invalid',
            rawHex: buffer.toString('hex')
        };
    }
}

/**
 * Decode specifically as an instruction
 * @param base64Data - Base64 encoded program data
 * @returns Decoded instruction data
 */
export function decodeAsInstruction(base64Data: string): DecodedInstruction {
    return decodeInstruction(base64Data);
}

/**
 * Decode specifically as an event
 * @param base64Data - Base64 encoded program data
 * @returns Decoded event data
 */
export function decodeAsEvent(base64Data: string): DecodedEvent {
    return decodeEvent(base64Data);
}

/**
 * Get all supported instruction names
 */
export function getSupportedInstructions(): string[] {
    return Object.keys(INSTRUCTION_DISCRIMINATORS);
}

/**
 * Get all supported event names
 */
export function getSupportedEvents(): string[] {
    return Object.keys(EVENT_DISCRIMINATORS);
}

/**
 * Pretty print decoded data
 * @param decoded - Decoded data result
 * @returns Formatted string representation
 */
export function prettyPrint(decoded: DecodedData): string {
    const lines: string[] = [];
    
    if (decoded.type === 'instruction') {
        const inst = decoded.data;
        lines.push(`=== INSTRUCTION: ${inst.instruction.toUpperCase()} ===`);
        
        if ('error' in inst) {
            lines.push(`ERROR: ${inst.error}`);
            lines.push(`Discriminator: ${inst.discriminator}`);
            lines.push(`Raw Hex: ${inst.rawHex}`);
        } else {
            // Pretty print instruction fields
            Object.entries(inst).forEach(([key, value]) => {
                if (key !== 'instruction') {
                    lines.push(`${key}: ${value}`);
                }
            });
        }
    } else if (decoded.type === 'event') {
        const event = decoded.data;
        lines.push(`=== EVENT: ${event.event.toUpperCase()} ===`);
        
        if ('error' in event) {
            lines.push(`ERROR: ${event.error}`);
            lines.push(`Discriminator: ${event.discriminator}`);
            lines.push(`Raw Hex: ${event.rawHex}`);
        } else {
            // Pretty print event fields
            Object.entries(event).forEach(([key, value]) => {
                if (key !== 'event') {
                    lines.push(`${key}: ${value}`);
                }
            });
        }
    } else {
        lines.push(`=== UNKNOWN DATA ===`);
        lines.push(`Discriminator: ${decoded.discriminator}`);
        lines.push(`Raw Hex: ${decoded.rawHex}`);
    }
    
    return lines.join('\n');
}

// CLI-style decoder function for testing
export function decodeAndPrint(base64Data: string): void {
    console.log('=== VIA LABS V4 MESSAGE GATEWAY DECODER ===');
    console.log(`Input: ${base64Data.substring(0, 50)}${base64Data.length > 50 ? '...' : ''}`);
    console.log();
    
    try {
        const result = decode(base64Data);
        console.log(prettyPrint(result));
    } catch (error) {
        console.log('DECODE ERROR:', (error as Error).message);
    }
}