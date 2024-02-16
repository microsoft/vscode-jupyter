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

        const executionCount = this.kernelProvider.getKernelExecution(kernel).executionCount;

        const cacheKey = this.variableResultCache.getCacheKey(notebook.uri.toString(), parent, start);
        let results = this.variableResultCache.getResults(executionCount, cacheKey);

        if (parent) {
            const parentDescription = parent as IVariableDescription;
            if (!results && parentDescription.getChildren) {
                const variables = await parentDescription.getChildren(start, token);
                results = variables.map((variable) => this.createVariableResult(variable, kernel));
                this.variableResultCache.setResults(executionCount, cacheKey, results);
            } else if (!results) {
                // no cached results and no way to get children, so return empty
                return;
            }

            for (const result of results) {
                yield result;
            }

            // check if we have more indexed children to return
            if (
                kind === 2 &&
                parentDescription.count &&
                results.length > 0 &&
                parentDescription.count > start + results.length
            ) {
                for await (const result of this.provideVariables(
                    notebook,
                    parent,
                    kind,
                    start + results.length,
                    token
                )) {
                    yield result;
                }
            }
        } else {
            if (!results) {
                const variables = await this.variables.getAllVariableDiscriptions(kernel, undefined, start, token);
                results = variables.map((variable) => this.createVariableResult(variable, kernel));
                this.variableResultCache.setResults(executionCount, cacheKey, results);
            }

            for (const result of results) {
                yield result;
            }
        }
    }

    private createVariableResult(result: IVariableDescription, kernel: IKernel): VariablesResult {
        const hasNamedChildren = !!result.properties;
        const indexedChildrenCount = result.count ?? 0;
        const variable = {
            getChildren: (start: number, token: CancellationToken) => this.getChildren(variable, start, kernel, token),
            expression: createExpression(result.root, result.propertyChain),
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

function createExpression(root: string, propertyChain: (string | number)[]): string {
    let expression = root;
    for (const property of propertyChain) {
        if (typeof property === 'string') {
            expression += `.${property}`;
        } else {
            expression += `[${property}]`;
        }
    }
    return expression;
}
