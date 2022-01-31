// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';
import { BaseError } from '../../common/errors/types';
import { traceError } from '../../common/logger';
import { KernelInterpreterDependencyResponse } from '../types';

export class IpyKernelNotInstalledError extends BaseError {
    constructor(
        message: string,
        public reason: KernelInterpreterDependencyResponse,
        public readonly anotherKernelSelected: boolean,
        public readonly firstQueuedCell?: NotebookCell
    ) {
        super('noipykernel', message);
        traceError(`IPykernel not detected`);
    }
}
