// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Uri } from 'vscode';

declare module './api' {
    export interface IJupyterVariable {
        name: string;
        type: string;
        fileName?: Uri;
    }
}
