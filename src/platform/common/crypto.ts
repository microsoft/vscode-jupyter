// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { injectable } from 'inversify';
import { traceError } from '../logging';
import { ICryptoUtils, IHashFormat } from './types';
import * as hashjs from 'hash.js';

/**
 * Provides hashing functions. These hashing functions should only be used for non sensitive data. For sensitive data, use msrCrypto instead.
 */
@injectable()
export class CryptoUtils implements ICryptoUtils {
    public createHash<E extends keyof IHashFormat>(
        data: string,
        hashFormat: E,
        algorithm: 'SHA512' | 'SHA256' = 'SHA256'
    ): IHashFormat[E] {
        let hash: string;
        if (algorithm === 'SHA256') {
            hash = hashjs.sha256().update(data).digest('hex');
        } else {
            hash = hashjs.sha512().update(data).digest('hex');
        }
        if (hashFormat === 'number') {
            const result = parseInt(hash, 16);
            if (isNaN(result)) {
                traceError(`Number hash for data '${data}' is NaN`);
            }
            return result as any;
        }
        return hash as any;
    }
}
