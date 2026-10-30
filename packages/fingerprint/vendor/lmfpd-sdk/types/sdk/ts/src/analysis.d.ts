import { type SharedDetector } from '@fingerpoint/shared/shared-detector';
import type { Analysis as CoreAnalysis, Bank } from '@fingerpoint/shared/types';
import type { Analysis, Output } from './types.js';
export declare const SCORING_FAILED = "Scoring failed. Check that the reference bank and detector files are valid.";
/** Fills the keys the core omits, so every SDK returns the same key set. */
export declare function canonicalAnalysis(a: CoreAnalysis): Analysis;
export declare function score(outputs: Output[], bank: Bank, detector: SharedDetector, strict: boolean): Analysis;
/** Scores saved replies like `fpd --input`: extra numbers are cut in relaxed mode, short replies count as missing. */
export declare function analyzeOutputs(outputs: Output[], bank: Bank, detector: SharedDetector, strict: boolean): Analysis;
