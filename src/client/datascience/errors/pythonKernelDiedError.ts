// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../common/errors/types';
import { DataScience } from '../../common/utils/localize';

export class PythonKernelDiedError extends BaseError {
    public readonly exitCode: number;
    public readonly reason?: string;
    public readonly errorMessage: string;
    constructor(options: { exitCode: number; reason?: string; stdErr: string } | { error: Error; stdErr: string }) {
        // Last line in stack traces generally contains the error message.
        // Display that in the error message.
        let reason = ('reason' in options ? options.reason || '' : options.stdErr).trim().split('\n').reverse()[0];
        reason = reason ? `${reason}, \n` : '';
        // No point displaying exit code if its 1 (thats not useful information).
        const exitCodeMessage = 'exitCode' in options && options.exitCode > 1 ? ` (code: ${options.exitCode}). ` : '';
        const message =
            'exitCode' in options
                ? `${exitCodeMessage}${reason}${options.reason === options.stdErr ? '' : options.reason}`
                : options.error.message;
        super('kerneldied', DataScience.kernelDied().format(message.trim()));
        this.errorMessage = message;
        this.stdErr = options.stdErr;
        if ('exitCode' in options) {
            this.exitCode = options.exitCode;
            this.reason = options.reason;
        } else {
            this.exitCode = -1;
            this.reason = options.error.message;
            this.stack = options.error.stack;
            this.name = options.error.name;
        }
    }
}
