/**
 * Central export for all test setup utilities
 */

// Load environment variables from .env file
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Export all constants
export * from "./constants";

// Export all helpers
export * from "./helpers";

// Export test context
export { TestContext } from "./context";

// Export all fixtures
export * from "./fixtures";