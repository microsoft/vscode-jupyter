// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { CancellationToken } from 'vscode';
import { Resource } from '../../../../common/types';
import { IInterpreterSelector } from '../../../../interpreter/configuration/types';
import { IKernelSelectionListProvider, PythonKernelConnectionMetadata, IKernelSpecQuickPickItem } from '../types';

/**
 * Provider for interpreters to be treated as kernel specs.
 * I.e. return interpreters that are to be treated as kernel specs, and not yet installed as kernels.
 *
 * @export
 * @class InterpreterKernelSelectionListProvider
 * @implements {IKernelSelectionListProvider}
 */
export class InterpreterKernelSelectionListProvider
    implements IKernelSelectionListProvider<PythonKernelConnectionMetadata> {
    constructor(private readonly interpreterSelector: IInterpreterSelector) {}
    public async getKernelSelections(
        resource: Resource,
        _cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<PythonKernelConnectionMetadata>[]> {
        const items = await this.interpreterSelector.getSuggestions(resource);
        return items
            ? items.map((item) => {
                  return {
                      ...item,
                      // We don't want descriptions.
                      description: '',
                      selection: {
                          kernelModel: undefined,
                          interpreter: item.interpreter,
                          kernelSpec: undefined,
                          kind: 'startUsingPythonInterpreter'
                      }
                  };
              })
            : [];
    }
}
