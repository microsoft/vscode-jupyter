// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../common/errors/types';
import { DataScience } from '../../common/utils/localize';

export class KernelProcessExitedError extends BaseError {
    constructor(public readonly exitCode: number = -1, public readonly stdErr: string) {
        super('kerneldied', DataScience.kernelDied().format(stdErr.trim()));
    }
}
