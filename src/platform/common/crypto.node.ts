// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { injectable } from 'inversify';
import { IHashFormat } from './types';
import { CryptoUtils } from './crypto';

/**
 * Implements tools related to cryptography
 */
@injectable()
export class CryptoUtilsNode extends CryptoUtils {
    public override createHash<E extends keyof IHashFormat>(
        data: string,
        hashFormat: E,
        algorithm: 'SHA512' | 'SHA256' | 'FNV' = 'FNV'
    ): IHashFormat[E] {
        if (algorithm === 'FNV') {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const fnv = require('@enonic/fnv-plus');
            let hash = fnv.fast1a32hex(data) as string;
            return hash as any;
        }

        return super.createHash(data, hashFormat, algorithm);
    }
}
