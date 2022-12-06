// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { DataScience } from '../../platform/common/utils/localize';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from './types';

/**
 * Thrown when kernel does not come back from wait for idle.
 *
 * Cause:
 * Jupyter [session](https://jupyterlab.readthedocs.io/en/stable/api/modules/services.session.html) never returns an 'idle' status message on startup.
 * This might happen if the kernel hangs. One such example was this issue: https://github.com/microsoft/vscode-jupyter/issues/10940
 *
 * Handled by:
 * Should show up in the executing cell (if there is one), otherwise a notification will pop up.
 *
 */
export class JupyterWaitForIdleError extends BaseKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super('timeout', DataScience.jupyterLaunchTimedOut(), kernelConnectionMetadata);
    }
}
