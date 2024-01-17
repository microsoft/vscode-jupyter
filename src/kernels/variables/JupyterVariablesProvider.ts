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
import { VariableResultCache } from './variableResultCache';

export class JupyterVariablesProvider implements NotebookVariableProvider {
    private variableResultCache = new VariableResultCache();

    _onDidChangeVariables = new EventEmitter<NotebookDocument>();
    onDidChangeVariables = this._onDidChangeVariables.event;

    constructor(
        private readonly variables: IJupyterVariables,
        private readonly kernelProvider: IKernelProvider
    ) {}

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

        const arr = [];
        for (let i = 0; i < 10000; i++) {
            arr.push(i);
        }

        const executionCount = this.kernelProvider.getKernelExecution(kernel).executionCount;

        const cacheKey = this.variableResultCache.getCacheKey(notebook.uri.toString(), parent);
        let results = this.variableResultCache.getResults(executionCount, cacheKey);

        if (!results) {
            if (parent) {
                if ('getChildren' in parent && typeof parent.getChildren === 'function') {
                    const variables = (await parent.getChildren(start, token)) as IVariableDescription[];
                    results = variables.map((variable) => this.createVariableResult(variable, kernel));
                }
            } else {
                const variables = await this.variables.getAllVariableDiscriptions(kernel, undefined, start, token);
                results = variables.map((variable) => this.createVariableResult(variable, kernel));
            }
        }

        if (!results) {
            return;
        }

        this.variableResultCache.setResults(executionCount, cacheKey, results);

        for (const result of results) {
            yield result;
        }
    }

    private createVariableResult(result: IVariableDescription, kernel: IKernel): VariablesResult {
        const hasNamedChildren = !!result.properties;
        const indexedChildrenCount = result.count ?? 0;
        const variable = {
            getChildren: (start: number, token: CancellationToken) => this.getChildren(variable, start, kernel, token),
            ...result
        } as Variable;
        return { variable, hasNamedChildren, indexedChildrenCount };
    }

    async getChildren(
        variable: Variable,
        start: number,
        kernel: IKernel,
        token: CancellationToken
    ): Promise<IVariableDescription[]> {
        const parent = variable as IVariableDescription;
        return await this.variables.getAllVariableDiscriptions(kernel, parent, start, token);
    }
}
