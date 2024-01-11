// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationToken,
    NotebookDocument,
    NotebookVariableProvider,
    Variable,
    NotebookVariablesRequestKind,
    VariablesResult,
    EventEmitter
} from 'vscode';
import { IKernelVariableRequester, IVariableDescription } from './types';
import { IKernel, IKernelProvider } from '../types';
import { named } from 'inversify';
import { Identifiers } from '../../platform/common/constants';

export class JupyterVariablesProvider implements NotebookVariableProvider {
    constructor(
        @named(Identifiers.PYTHON_VARIABLES_REQUESTER)
        private readonly pythonVariableRequester: IKernelVariableRequester,
        private readonly kernelProvider: IKernelProvider
    ) {}

    _onDidChangeVariables = new EventEmitter<NotebookDocument>();
    onDidChangeVariables = this._onDidChangeVariables.event;

    async *provideVariables(
        notebook: NotebookDocument,
        parent: Variable | undefined,
        _kind: NotebookVariablesRequestKind,
        start: number,
        token: CancellationToken
    ): AsyncIterable<VariablesResult> {
        if (token.isCancellationRequested) {
            return;
        }
        const kernel = this.kernelProvider.get(notebook);
        if (!kernel) {
            return;
        }

        if (parent) {
            if ('getChildren' in parent && typeof parent.getChildren === 'function') {
                await parent.getChildren(start);
            }
        } else {
            const variables = await this.pythonVariableRequester.getAllVariableDiscriptions(kernel, undefined);

            for (const variable of variables) {
                const hasNamedChildren = variable.properties && variable.properties?.length > 0;
                const indexedChildrenCount = variable.count && variable.count > 0;
                yield {
                    variable,
                    hasNamedChildren,
                    indexedChildrenCount,
                    getChildren: (start: number) => this.getChildren(variable, start, kernel)
                } as VariablesResult;
            }
        }
    }

    async getChildren(variable: Variable, _start: number, kernel: IKernel): Promise<IVariableDescription[]> {
        const parent = variable as IVariableDescription;
        return await this.pythonVariableRequester.getAllVariableDiscriptions(kernel, parent);
    }
}
