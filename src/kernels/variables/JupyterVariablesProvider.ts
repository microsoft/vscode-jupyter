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
import { IJupyterVariable, IJupyterVariables, IJupyterVariablesRequest, IJupyterVariablesResponse } from './types';
import { IKernel, IKernelProvider, INotebookKernelExecution } from '../types';

const pythonRawTypes = ['int', 'float', 'str', 'bool'];

export class JupyterVariablesProvider implements NotebookVariableProvider {
    constructor(
        private readonly jupyterVariables: IJupyterVariables,
        private readonly kernelProvider: IKernelProvider
    ) {}

    _onDidChangeVariables = new EventEmitter<NotebookDocument>();
    onDidChangeVariables = this._onDidChangeVariables.event;

    async *provideVariables(
        notebook: NotebookDocument,
        parent: Variable | undefined,
        kind: NotebookVariablesRequestKind,
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

        const execution = this.kernelProvider.getKernelExecution(kernel);

        if (parent) {
            if ('getChildren' in parent && typeof parent.getChildren === 'function') {
                await parent.getChildren(kind);
            }
        } else {
            const variables = await this.getRootVariables(execution, start, kernel);

            for (const variable of variables.pageResponse) {
                const result = { name: variable.name, value: variable.value ?? '' };
                const hasNamedChildren = !pythonRawTypes.includes(variable.type);
                const indexedChildrenCount = variable.type === 'list' ? variable.count : 0;
                yield {
                    variable: result,
                    hasNamedChildren,
                    indexedChildrenCount
                    //getChildren: (kind: NotebookVariablesRequestKind) => this.getChildren(variable, kernel, kind, start)
                } as VariablesResult;
            }
        }
    }

    // async getChildren(
    //     variable: IJupyterVariable,
    //     kernel: IKernel,
    //     kind: NotebookVariablesRequestKind,
    //     start: number
    // ): Promise<IJupyterVariablesResponse> {
    //     if (kind === NotebookVariablesRequestKind.Indexed) {

    //     } else {

    //     }
    // }

    private async getRootVariables(
        execution: INotebookKernelExecution,
        start: number,
        kernel: IKernel
    ): Promise<IJupyterVariablesResponse> {
        const request: IJupyterVariablesRequest = {
            executionCount: execution.executionCount,
            sortAscending: true,
            sortColumn: 'name',
            pageSize: 10,
            refreshCount: 0,
            startIndex: start
        };
        const response = this.jupyterVariables.getVariables(request, kernel);

        return response;
    }
}
