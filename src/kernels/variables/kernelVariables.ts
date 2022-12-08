// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import type { JSONObject } from '@lumino/coreutils';
import { inject, injectable, named } from 'inversify';
import { CancellationError, CancellationToken, Event, EventEmitter } from 'vscode';
import { Identifiers, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { IConfigurationService, IDisposableRegistry } from '../../platform/common/types';
import { createDeferred } from '../../platform/common/utils/async';
import { getKernelConnectionLanguage, isPythonKernelConnection } from '../helpers';
import { IKernel, IKernelConnectionSession, IKernelProvider } from '../types';
import {
    IJupyterVariable,
    IJupyterVariables,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse,
    IKernelVariableRequester
} from './types';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports

// Regexes for parsing data from Python kernel. Not sure yet if other
// kernels will add the ansi encoding.
const TypeRegex = /.*?\[.*?;31mType:.*?\[0m\s+(\w+)/;
const ValueRegex = /.*?\[.*?;31mValue:.*?\[0m\s+(.*)/;
const StringFormRegex = /.*?\[.*?;31mString form:.*?\[0m\s+?([\s\S]+?)\n(.*\[.*;31m?)/;
const DocStringRegex = /.*?\[.*?;31mDocstring:.*?\[0m\s+(.*)/;
const CountRegex = /.*?\[.*?;31mLength:.*?\[0m\s+(.*)/;
const ShapeRegex = /^\s+\[(\d+) rows x (\d+) columns\]/m;

const DataViewableTypes: Set<string> = new Set<string>([
    'DataFrame',
    'list',
    'dict',
    'ndarray',
    'Series',
    'Tensor',
    'EagerTensor',
    'DataArray'
]);
interface INotebookState {
    currentExecutionCount: number;
    variables: IJupyterVariable[];
}

/**
 * Reponsible for providing variable data when connected to a kernel and not debugging
 * (Kernels are paused while debugging so we have to use another means to query data)
 */
@injectable()
export class KernelVariables implements IJupyterVariables {
    private variableRequesters = new Map<string, IKernelVariableRequester>();
    private cachedVariables = new Map<string, INotebookState>();
    private refreshEventEmitter = new EventEmitter<void>();

    constructor(
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IKernelVariableRequester)
        @named(Identifiers.PYTHON_VARIABLES_REQUESTER)
        pythonVariableRequester: IKernelVariableRequester,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider
    ) {
        this.variableRequesters.set(PYTHON_LANGUAGE, pythonVariableRequester);
    }

    public get refreshRequired(): Event<void> {
        return this.refreshEventEmitter.event;
    }

    // IJupyterVariables implementation
    public async getVariables(request: IJupyterVariablesRequest, kernel: IKernel): Promise<IJupyterVariablesResponse> {
        // Run the language appropriate variable fetch
        return this.getVariablesBasedOnKernel(kernel, request);
    }

    public async getMatchingVariable(
        name: string,
        kernel: IKernel,
        token?: CancellationToken
    ): Promise<IJupyterVariable | undefined> {
        // See if in the cache
        const cache = this.cachedVariables.get(kernel.uri.toString());
        if (cache) {
            let match = cache.variables.find((v) => v.name === name);
            if (match && !match.value) {
                match = await this.getVariableValueFromKernel(match, kernel, token);
            }
            return match;
        } else {
            // No items in the cache yet, just ask for the names
            const variables = await this.getVariableNamesAndTypesFromKernel(kernel, token);
            if (variables) {
                const matchName = variables.find((v) => v.name === name);
                if (matchName) {
                    return this.getVariableValueFromKernel(
                        {
                            name,
                            value: undefined,
                            supportsDataExplorer: false,
                            type: matchName.type,
                            size: 0,
                            count: 0,
                            shape: '',
                            truncated: true
                        },
                        kernel,
                        token
                    );
                }
            }
        }
    }

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        sliceExpression?: string,
        isRefresh?: boolean
    ): Promise<IJupyterVariable> {
        const languageId = getKernelConnectionLanguage(kernel?.kernelConnectionMetadata) || PYTHON_LANGUAGE;
        const variableRequester = this.variableRequesters.get(languageId);
        if (variableRequester) {
            if (isRefresh) {
                targetVariable = await this.getFullVariable(targetVariable, kernel);
            }

            let expression = targetVariable.name;
            if (sliceExpression) {
                expression = `${targetVariable.name}${sliceExpression}`;
            }
            return variableRequester.getDataFrameInfo(targetVariable, kernel, expression);
        }
        return targetVariable;
    }

    public async getDataFrameRows(
        targetVariable: IJupyterVariable,
        start: number,
        end: number,
        kernel: IKernel,
        sliceExpression?: string
    ): Promise<{ data: Record<string, unknown>[] }> {
        const language = getKernelConnectionLanguage(kernel?.kernelConnectionMetadata) || PYTHON_LANGUAGE;
        const variableRequester = this.variableRequesters.get(language);
        if (variableRequester) {
            let expression = targetVariable.name;
            if (sliceExpression) {
                expression = `${targetVariable.name}${sliceExpression}`;
            }
            return variableRequester.getDataFrameRows(start, end, kernel, expression);
        }
        return { data: [] };
    }

    public async getFullVariable(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        token?: CancellationToken
    ): Promise<IJupyterVariable> {
        const languageId = getKernelConnectionLanguage(kernel?.kernelConnectionMetadata) || PYTHON_LANGUAGE;
        const variableRequester = this.variableRequesters.get(languageId);
        if (variableRequester) {
            return variableRequester.getFullVariable(targetVariable, kernel, token);
        }
        return targetVariable;
    }

    private async getVariablesBasedOnKernel(
        kernel: IKernel,
        request: IJupyterVariablesRequest
    ): Promise<IJupyterVariablesResponse> {
        // See if we already have the name list
        let list = this.cachedVariables.get(kernel.uri.toString());
        const hasExecutingCells = this.kernelProvider.getKernelExecution(kernel).pendingCells.length > 0;
        const execution = this.kernelProvider.getKernelExecution(kernel);
        if (
            !list ||
            (!hasExecutingCells &&
                (list.currentExecutionCount !== request.executionCount ||
                    list.currentExecutionCount !== execution.executionCount))
        ) {
            // Refetch the list of names from the notebook. They might have changed.
            list = {
                currentExecutionCount: execution.executionCount,
                variables: (await this.getVariableNamesAndTypesFromKernel(kernel)).map((v) => {
                    return {
                        name: v.name,
                        value: undefined,
                        supportsDataExplorer: false,
                        type: v.type,
                        size: 0,
                        shape: '',
                        count: 0,
                        truncated: true
                    };
                })
            };
        }

        const exclusionList = this.configService.getSettings(kernel.resourceUri).variableExplorerExclude
            ? this.configService.getSettings().variableExplorerExclude?.split(';')
            : [];

        const result: IJupyterVariablesResponse = {
            executionCount: execution.executionCount,
            pageStartIndex: -1,
            pageResponse: [],
            totalCount: 0,
            refreshCount: request.refreshCount
        };

        // Use the list of names to fetch the page of data
        if (list) {
            type SortableColumn = 'name' | 'type';
            const sortColumn = request.sortColumn as SortableColumn;
            const comparer = (a: IJupyterVariable, b: IJupyterVariable): number => {
                // In case it is undefined or null
                const aColumn = a[sortColumn] ? a[sortColumn] : '';
                const bColumn = b[sortColumn] ? b[sortColumn] : '';

                if (request.sortAscending) {
                    return aColumn.localeCompare(bColumn, undefined, { sensitivity: 'base' });
                } else {
                    return bColumn.localeCompare(aColumn, undefined, { sensitivity: 'base' });
                }
            };
            list.variables.sort(comparer);

            const startPos = request.startIndex ? request.startIndex : 0;
            const chunkSize = request.pageSize ? request.pageSize : 100;
            result.pageStartIndex = startPos;

            // Do one at a time. All at once doesn't work as they all have to wait for each other anyway
            for (let i = startPos; i < startPos + chunkSize && i < list.variables.length; ) {
                if (exclusionList && exclusionList.indexOf(list.variables[i].type) >= 0) {
                    // Remove from the list before fetching the full value
                    list.variables.splice(i, 1);
                    continue;
                }

                const fullVariable = list.variables[i].value
                    ? list.variables[i]
                    : await this.getVariableValueFromKernel(list.variables[i], kernel);

                list.variables[i] = fullVariable;
                result.pageResponse.push(fullVariable);
                i += 1;
            }

            // Save in our cache
            this.cachedVariables.set(kernel.uri.toString(), list);

            // Update total count (exclusions will change this as types are computed)
            result.totalCount = list.variables.length;
        }

        return result;
    }

    public async getVariableProperties(
        word: string,
        kernel: IKernel,
        cancelToken: CancellationToken | undefined
    ): Promise<{ [attributeName: string]: string }> {
        const matchingVariable = await this.getMatchingVariable(word, kernel, cancelToken);
        const languageId = getKernelConnectionLanguage(kernel.kernelConnectionMetadata) || PYTHON_LANGUAGE;

        const variableRequester = this.variableRequesters.get(languageId);
        if (variableRequester) {
            return variableRequester.getVariableProperties(word, cancelToken, matchingVariable);
        }

        return {};
    }

    private async getVariableNamesAndTypesFromKernel(
        kernel: IKernel,
        token?: CancellationToken
    ): Promise<IJupyterVariable[]> {
        // Get our query and parser
        const languageId = getKernelConnectionLanguage(kernel.kernelConnectionMetadata) || PYTHON_LANGUAGE;
        const variableRequester = this.variableRequesters.get(languageId);
        if (variableRequester) {
            return variableRequester.getVariableNamesAndTypesFromKernel(kernel, token);
        }

        return [];
    }

    private inspect(
        session: IKernelConnectionSession,
        code: string,
        offsetInCode = 0,
        cancelToken?: CancellationToken
    ): Promise<JSONObject> {
        // Create a deferred that will fire when the request completes
        const deferred = createDeferred<JSONObject>();

        try {
            // Ask session for inspect result
            session
                .requestInspect({ code, cursor_pos: offsetInCode, detail_level: 0 })
                .then((r) => {
                    if (r && r.content.status === 'ok') {
                        deferred.resolve(r.content.data);
                    } else {
                        deferred.resolve(undefined);
                    }
                })
                .catch((ex) => {
                    deferred.reject(ex);
                });
        } catch (ex) {
            deferred.reject(ex);
        }

        if (cancelToken) {
            this.disposables.push(cancelToken.onCancellationRequested(() => deferred.reject(new CancellationError())));
        }

        return deferred.promise;
    }
    // eslint-disable-next-line complexity
    private async getVariableValueFromKernel(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        token?: CancellationToken
    ): Promise<IJupyterVariable> {
        let result = { ...targetVariable };
        if (!kernel.disposed && kernel.session) {
            const output = await this.inspect(kernel.session, targetVariable.name, 0, token);

            // Should be a text/plain inside of it (at least IPython does this)
            if (output && output.hasOwnProperty('text/plain')) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const text = (output as any)['text/plain'].toString() as string;

                // Parse into bits
                const type = TypeRegex.exec(text);
                const count = CountRegex.exec(text);
                const shape = ShapeRegex.exec(text);
                if (type) {
                    result.type = type[1];
                }

                // Take the first regex that returns a value
                result.value = [ValueRegex, StringFormRegex, DocStringRegex].reduce(
                    (value, regex) => value || regex.exec(text)?.[1] || '',
                    ''
                );

                if (count) {
                    result.count = parseInt(count[1], 10);
                }
                if (shape) {
                    result.shape = `(${shape[1]}, ${shape[2]})`;
                }
            }

            // Otherwise look for the appropriate entries
            if (output && output.type) {
                result.type = output.type.toString();
            }
            if (output && output.value) {
                result.value = output.value.toString();
            }

            // Determine if supports viewing based on type
            if (DataViewableTypes.has(result.type)) {
                result.supportsDataExplorer = true;
            }
        }

        // For a python kernel, we might be able to get a better shape. It seems the 'inspect' request doesn't always return it.
        // Do this only when necessary as this is a LOT slower than an inspect request. Like 4 or 5 times as slow
        if (
            result.type &&
            result.count &&
            !result.shape &&
            isPythonKernelConnection(kernel.kernelConnectionMetadata) &&
            result.supportsDataExplorer &&
            result.type !== 'list' // List count is good enough
        ) {
            result = await this.getFullVariable(result, kernel);
        }

        return result;
    }
}
