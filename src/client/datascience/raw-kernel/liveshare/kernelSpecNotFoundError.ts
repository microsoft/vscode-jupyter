// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { BaseError } from '../../../common/errors/types';

export class KernelSpecNotFoundError extends BaseError {
    constructor(public readonly notebookMetadata?: Readonly<nbformat.INotebookMetadata>) {
        super('kernelspecnotfound', 'Failed to find a kernelspec to use for ipykernel launch');
    }
}
