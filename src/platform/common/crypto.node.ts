// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { injectable } from 'inversify';
import { ICryptoUtils, IHashFormat } from './types';
import { CryptoUtils } from './crypto';
import { traceError } from '../logging';

/**
 * Implements tools related to cryptography
 */
@injectable()
export class CryptoUtilsNode extends CryptoUtils implements ICryptoUtils {
    public override createHash<E extends keyof IHashFormat>(
        data: string,
        hashFormat: E,
        algorithm: 'SHA512' | 'SHA256' | 'FNV' = 'FNV'
    ): IHashFormat[E] {
        if (algorithm === 'FNV') {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const fnv = require('@enonic/fnv-plus');
            const hash = fnv.fast1a32hex(data) as string;
            if (hashFormat === 'number') {
                const result = parseInt(hash, 16);
                if (isNaN(result)) {
                    traceError(`Number hash for data '${data}' is NaN`);
                }
                return result as any;
            }
            return hash as any;
        }

        return super.createHash(data, hashFormat, algorithm);
    }
}
