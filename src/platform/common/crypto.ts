// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { injectable } from 'inversify';
import { ICryptoUtils } from './types';
import * as hashjs from 'hash.js';

/**
 * Provides hashing functions. These hashing functions should only be used for non sensitive data. For sensitive data, use msrCrypto instead.
 */
@injectable()
export class CryptoUtils implements ICryptoUtils {
    public async createHash(data: string, algorithm: 'SHA512' | 'SHA256' = 'SHA256'): Promise<string> {
        return computeHash(data, algorithm);
    }
}

export function computeHash(data: string, algorithm: 'SHA512' | 'SHA256' | 'SHA1') {
    if (algorithm === 'SHA1') {
        return hashjs.sha1().update(data).digest('hex');
    } else if (algorithm === 'SHA256') {
        return hashjs.sha256().update(data).digest('hex');
    } else {
        return hashjs.sha512().update(data).digest('hex');
    }
}
