// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function toPythonSafePath(filePath: string): string {
    return `r"${filePath}"`;
}
