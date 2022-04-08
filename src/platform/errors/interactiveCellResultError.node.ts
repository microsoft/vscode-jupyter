// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';

// Small helper error to use in our class
export class InteractiveCellResultError extends Error {
    constructor(public readonly cell: NotebookCell) {
        super('Cell failed to execute');
    }
}
