// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookDocument } from 'vscode';

export const IReplNotebookTrackerService = Symbol('IReplNotebookTrackerService');
export interface IReplNotebookTrackerService {
    isForReplEditor(notebook: NotebookDocument): boolean;
}
