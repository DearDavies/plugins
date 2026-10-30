import { type DetectionOptions } from '@fingerpoint/shared/detect-request';
import type { DetectConfig } from './types.js';
/** Validates an SDK config and fills the detection options with the SDK defaults. Throws on an invalid config. */
export declare function detectOptions(input: DetectConfig): DetectionOptions;
