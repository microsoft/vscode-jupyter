// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { workspace } from 'vscode';

export class KernelPickerType {
    public static get useNewKernelPicker() {
        return (
            workspace.getConfiguration('jupyter').get<string>('experimental.kernelPickerType', 'Stable') === 'Insiders'
        );
    }
}
