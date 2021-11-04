// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../common/errors/types';
import { DataScience } from '../../common/utils/localize';
import { Commands } from '../constants';

export class KernelProcessExited extends BaseError {
    constructor(public readonly exitCode: number = -1, public readonly stdErr: string) {
        super('kerneldied', DataScience.kernelDied().format(Commands.ViewJupyterOutput, stdErr.trim()));
    }
}
