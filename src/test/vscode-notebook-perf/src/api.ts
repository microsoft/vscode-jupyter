// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Metrics = {
    preExecuteDuration: number;
    executeDuration: number;
    postExecuteDuration: number;
    duration: number;
};
export type API = {
    executeNotebook(outputType: 'text' | 'html' | 'image'): Promise<Metrics>;
};
