// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { logMessage } from '../../react-common/logger';

const unpgkUrl = 'https://unpkg.com/';
const jsdelivrUrl = 'https://www.jsdelivr.com/';
const networkAccessTimeoutMs = 1_000;
/**
 * Checks whether we can access one of the CDN sites.
 */
export async function isCDNReachable() {
    const abort = new AbortController();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let timeout: any;
    const promise = new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
            resolve(false);
            abort.abort();
        }, networkAccessTimeoutMs);
    });
    promise.catch(() => {
        /**/
    });
    try {
        return await Promise.race([
            isWebSiteReachable(unpgkUrl, abort.signal),
            isWebSiteReachable(jsdelivrUrl, abort.signal),
            promise
        ]);
    } finally {
        if (timeout) {
            clearInterval(timeout);
        }
    }
}

async function isWebSiteReachable(url: string, signal: AbortSignal) {
    try {
        const response = await fetch(url, { signal });
        return response.ok;
    } catch (ex) {
        logMessage(`Failed to access CDN ${url}, ${(ex || '').toString()}`);
        return false;
    }
}
