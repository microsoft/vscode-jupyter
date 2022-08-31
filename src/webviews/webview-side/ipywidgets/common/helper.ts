// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { logErrorMessage } from '../../react-common/logger';

const unpgkUrl = 'https://unpkg.com/';
const jsdelivrUrl = 'https://cdn.jsdelivr.net/npm/requirejs@2.3.6/bin/r.min.js';
const networkAccessTimeoutMs = 1_000;
let isOnlineOnceBefore = false;
/**
 * Checks whether we can access one of the CDN sites.
 */
export async function isCDNReachable() {
    if (isOnlineOnceBefore) {
        return true;
    }
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
        isOnlineOnceBefore = await Promise.race([
            isWebSiteReachable(unpgkUrl, abort.signal),
            isWebSiteReachable(jsdelivrUrl, abort.signal),
            promise
        ]);
        return isOnlineOnceBefore;
    } finally {
        if (timeout) {
            clearInterval(timeout);
        }
    }
}

async function isWebSiteReachable(url: string, signal: AbortSignal) {
    let retries = 0;
    try {
        for (retries = 0; retries < 5; retries++) {
            const response = await fetch(url, { signal });
            if (response.ok) {
                return true;
            }
        }
        return false;
    } catch (ex) {
        logErrorMessage(`Failed to access CDN ${url} after ${retries} attempts, ${(ex || '').toString()}`);
        return false;
    }
}
