import { type SharedDetector } from '@fingerpoint/shared/shared-detector';
import type { Bank } from '@fingerpoint/shared/types';
export interface ReferenceData {
    bank: Bank;
    detector: SharedDetector;
}
/**
 * A single source that is not an http(s) URL is a local directory, read as is. For URLs, answers from the cache file
 * when there is one (stale-while-revalidate): a cache last checked `ttl` seconds ago or earlier is refreshed in the
 * background for the next load. Without a cache it downloads.
 */
export declare function loadData(source?: string | readonly string[], cachePath?: string, ttl?: number): Promise<ReferenceData>;
