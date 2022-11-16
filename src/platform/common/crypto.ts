// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import type { ICryptoUtils } from './types';

@injectable()
export class CryptoUtils implements ICryptoUtils {
    public async createHash(data: string, algorithm: 'SHA-512' | 'SHA-256' = 'SHA-256'): Promise<string> {
        return computeHash(data, algorithm);
    }
}

const computedHashes: Record<string, string> = {};
let stopStoringHashes = false;

let cryptoProvider: Crypto =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, local-rules/node-imports
    typeof window === 'object' ? (window as any).crypto : require('node:crypto').webcrypto;

/**
 * Computes a hash for a give string and returns hash as a hex value.
 */
export async function computeHash(data: string, algorithm: 'SHA-512' | 'SHA-256' | 'SHA-1'): Promise<string> {
    // Save some CPU as this is called in a number of places.
    // This will not get too large, will only grow by number of files per workspace, even if user has
    // 1000s of files, this will not grow that large to cause any memory issues.
    // Files get hashed a lot in a number of places within the extension (.interactive is the IW window Uri).
    // Even things that include file paths like kernel id, which isn't a file path, but contains python executable path.
    const isCandidateForCaching = data.includes('/') || data.includes('\\') || data.endsWith('.interactive');
    if (isCandidateForCaching && computedHashes[data]) {
        return computedHashes[data];
    }

    const hash = await computeHashInternal(data, algorithm);

    if (isCandidateForCaching && !stopStoringHashes) {
        // Just a simple fail safe, why 10_000, simple why not 10_000
        // All we want to ensure is that we don't store too many hashes.
        // The only way we can get there is if user never closes VS Code and our code
        // ends up hashing Uris of cells, then again user would have to have 1000s of cells in notebooks to hit this case.
        if (Object.keys(computedHashes).length > 10_000) {
            stopStoringHashes = true;
        }
        computedHashes[data] = hash;
    }
    return hash;
}

async function computeHashInternal(data: string, algorithm: 'SHA-512' | 'SHA-256' | 'SHA-1'): Promise<string> {
    const inputBuffer = new TextEncoder().encode(data);
    const hashBuffer = await cryptoProvider.subtle.digest({ name: algorithm }, inputBuffer);

    // Turn into hash string (got this logic from https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
