// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { WrappedError } from '../../common/errors/types';

export class KernelDiedError extends WrappedError {
    constructor(message: string, public readonly stdErr: string, originalException?: Error) {
        super(message, originalException);
    }
}
