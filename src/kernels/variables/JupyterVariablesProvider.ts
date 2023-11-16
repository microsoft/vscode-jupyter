// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationToken,
    Event,
    NotebookDocument,
    NotebookVariableProvider,
    Variable,
    VariablesRequestKind,
    VariablesResult
} from 'vscode';
import { IJupyterVariables, IJupyterVariablesRequest } from './types';
import { IKernelProvider } from '../types';

export class JupyterVariablesProvider implements NotebookVariableProvider {
    constructor(
        private readonly jupyterVariables: IJupyterVariables,
        private readonly kernelProvider: IKernelProvider
    ) {}

    onDidChangeVariables: Event<void>;

    async *provideVariables(
        notebook: NotebookDocument,
        _parent: Variable | undefined,
        _kind: VariablesRequestKind,
        start: number,
        _token: CancellationToken
    ): AsyncIterable<VariablesResult> {
        const kernel = this.kernelProvider.get(notebook);
        if (!kernel) {
            return;
        }

        const execution = this.kernelProvider.getKernelExecution(kernel);
        const request: IJupyterVariablesRequest = {
            executionCount: execution.executionCount,
            sortAscending: true,
            sortColumn: 'name',
            pageSize: 10,
            refreshCount: 0,
            startIndex: start
        };
        const response = this.jupyterVariables.getVariables(request, kernel);

        const variables = await response;

        for (const variable of variables.pageResponse) {
            const result = { name: variable.name, value: variable.value ?? '' };
            yield {
                variable: result,
                namedChildrenCount: 0,
                indexedChildrenCount: 0
            };
        }
    }
}
