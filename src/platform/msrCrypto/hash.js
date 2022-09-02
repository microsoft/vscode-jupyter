// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Use window crypto if it's available, otherwise use the msrCrypto module, else fall back to importing.
const windowCrypto =
    typeof window === 'object' && window.crypto && window.crypto.subtle && window.crypto.subtle.subtle
        ? window.crypto
        : undefined;
const windowMsCrypto =
    typeof window === 'object' && window.msCrypto && window.msCrypto.subtle && window.msCrypto.subtle.subtle
        ? window.msCrypto
        : undefined;
// eslint-disable-next-line local-rules/node-imports
const crypto = windowCrypto || windowMsCrypto || require('./msrCrypto');

/**
 * Computes a hash for a given piece of string and returns it in hex format.
 *
 * @param {string} data
 * @param {('SHA-512' | 'SHA-256' | 'SHA-1')} algorithm
 * @return {string} Generated Hash in hex format
 */
exports.computeHash = async function computeHash(data, algorithm) {
    const inputBuffer = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest({ name: algorithm }, inputBuffer);

    // Turn into hash string (got this logic from https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};
