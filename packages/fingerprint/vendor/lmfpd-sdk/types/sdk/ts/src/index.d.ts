import type { Analysis, Challenge, DetectConfig, DetectOptions, DetectResult, LoadOptions, Output, Sample } from './types.js';
export type * from './types.js';
export { DEFAULT_DATA_URLS } from './types.js';
/** A loaded reference bank and detector. Create one with `loadDetector()`. */
export declare class Detector {
    #private;
    /** `built_at` of the reference bank, which identifies the data build. */
    readonly builtAt: string;
    private constructor();
    /**
     * Scores one to three saved replies. Three valid replies give a calibrated ranking; fewer give a partial ranking
     * unless `strict` is set.
     */
    analyze(outputs: Output[], options?: {
        strict?: boolean;
    }): Analysis;
    /**
     * Sends one round of challenges to the model API and scores the replies. Throws only on an invalid config.
     * `onSample` sees every change of a sample: first `queued` for each index, then its request until the final state.
     */
    detect(config: DetectConfig, { signal, onSample }?: DetectOptions): Promise<DetectResult>;
}
/**
 * Loads the reference data from a local directory, or from URLs through a cache file: an existing cache answers at once
 * and is refreshed in the background once it is `ttl` seconds old; without one the data is downloaded.
 */
export declare function loadDetector(options?: LoadOptions): Promise<Detector>;
/** Random challenges in one of five languages, each asking for a distinct count from 292 to 332. */
export declare function generateChallenges(count?: number): Challenge[];
/** The numbers 1 to 355 of the longest run in a reply; letters between numbers split runs. */
export declare function parseNumbers(text: string): number[];
/** The HTTP request `detect` sends for one prompt, or the config error. */
export declare function buildRequest(config: DetectConfig, prompt: string): {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
} | {
    error: string;
};
/** Sends one challenge and returns the checked reply. Request failures are reported in `error`. */
export declare function requestSample(config: DetectConfig, challenge: Challenge): Promise<Sample>;
