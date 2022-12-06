// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { DebugProtocol } from 'vscode-debugprotocol';

export const DataViewableTypes: Set<string> = new Set<string>([
    'DataFrame',
    'list',
    'dict',
    'ndarray',
    'Series',
    'Tensor',
    'EagerTensor',
    'DataArray'
]);

export function convertDebugProtocolVariableToIJupyterVariable(variable: DebugProtocol.Variable) {
    return {
        // If `evaluateName` is available use that. That is the name that we can eval in the debugger
        // but it's an optional property so fallback to `variable.name`
        name: variable.evaluateName ?? variable.name,
        type: variable.type!,
        count: 0,
        shape: '',
        size: 0,
        supportsDataExplorer: DataViewableTypes.has(variable.type || ''),
        value: variable.value,
        truncated: true,
        frameId: variable.variablesReference
    };
}
