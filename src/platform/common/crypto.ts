// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { computeHash } from './hash';
import type { ICryptoUtils } from './types';

/**
 * Provides hashing functions. These hashing functions should only be used for non sensitive data. For sensitive data, use msrCrypto instead.
 */
@injectable()
export class CryptoUtils implements ICryptoUtils {
    public async createHash(data: string, algorithm: 'SHA-512' | 'SHA-256' = 'SHA-256'): Promise<string> {
        return computeHash(data, algorithm);
    }
}
