// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Variable, VariablesResult } from 'vscode';
import { IVariableDescription } from './types';

export class VariableResultCache {
    private cache = new Map<string, VariablesResult[]>();
    private executionCount = 0;

    getCacheKey(notebookUri: string, parent: Variable | undefined): string {
        let parentKey = '';
        const parentDescription = parent as IVariableDescription;
        if (parentDescription) {
            parentKey = `${parentDescription.name}.${parentDescription.propertyChain.join('.')}`;
        }
        return `${notebookUri}:${parentKey}`;
    }

    getResults(executionCount: number, cacheKey: string): VariablesResult[] | undefined {
        if (this.executionCount !== executionCount) {
            this.cache.clear();
            this.executionCount = executionCount;
        }

        return this.cache.get(cacheKey);
    }

    setResults(executionCount: number, cacheKey: string, results: VariablesResult[]) {
        if (this.executionCount < executionCount) {
            this.cache.clear();
            this.executionCount = executionCount;
        } else if (this.executionCount > executionCount) {
            // old results, don't cache
            return;
        }

        this.cache.set(cacheKey, results);
    }
}
