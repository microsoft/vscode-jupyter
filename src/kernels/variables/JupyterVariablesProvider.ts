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
import { IJupyterVariables, IVariableDescription } from './types';
import { IKernel, IKernelProvider } from '../types';

export class JupyterVariablesProvider implements NotebookVariableProvider {
    constructor(
        private readonly variables: IJupyterVariables,
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
                const variables = await parent.getChildren(start);
                for (const variable of variables) {
                    yield this.createVariableResult(variable, kernel);
                }
            }
        } else {
            const variables = await this.variables.getAllVariableDiscriptions(kernel, undefined);

            for (const variable of variables) {
                yield this.createVariableResult(variable, kernel);
            }
        }
    }

    private createVariableResult(result: IVariableDescription, kernel: IKernel): VariablesResult {
        const hasNamedChildren = !!result.properties;
        const indexedChildrenCount = result.count ?? 0;
        const variable = {
            getChildren: (start: number) => this.getChildren(variable, start, kernel),
            ...result
        } as Variable;
        return { variable, hasNamedChildren, indexedChildrenCount };
    }

    async getChildren(variable: Variable, _start: number, kernel: IKernel): Promise<IVariableDescription[]> {
        const parent = variable as IVariableDescription;
        return await this.variables.getAllVariableDiscriptions(kernel, parent);
    }
}
