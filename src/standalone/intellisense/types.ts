// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface INotebookCompletion {
    matches: ReadonlyArray<string>;
    cursor: {
        start: number;
        end: number;
    };
    metadata: {
        _jupyter_types_experimental?: { end: number; start: number; text: string; type?: string }[];
    };
}
