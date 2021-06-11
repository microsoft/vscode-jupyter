// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';
import { CancellationToken, Event, EventEmitter, Uri } from 'vscode';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { Experiments } from '../../common/experiments/groups';
import { IConfigurationService, IExperimentService } from '../../common/types';
import { Identifiers } from '../constants';
import {
    IJupyterVariable,
    IJupyterVariables,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse,
    IKernelVariableRequester,
    INotebook
} from '../types';
import { getKernelConnectionLanguage, isPythonKernelConnection } from './kernels/helpers';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports

// Regexes for parsing data from Python kernel. Not sure yet if other
// kernels will add the ansi encoding.
const TypeRegex = /.*?\[.*?;31mType:.*?\[0m\s+(\w+)/;
const ValueRegex = /.*?\[.*?;31mValue:.*?\[0m\s+(.*)/;
const StringFormRegex = /.*?\[.*?;31mString form:.*?\[0m\s*?([\s\S]+?)\n(.*\[.*;31m?)/;
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

@injectable()
export class KernelVariables implements IJupyterVariables {
    private variableRequesters = new Map<string, IKernelVariableRequester>();
    private notebookState = new Map<Uri, INotebookState>();
    private refreshEventEmitter = new EventEmitter<void>();
    private enhancedTooltipsExperimentPromise: boolean | undefined;

    constructor(
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IExperimentService) private experimentService: IExperimentService,
        @inject(IKernelVariableRequester)
        @named(Identifiers.PYTHON_VARIABLES_REQUESTER)
        pythonVariableRequester: IKernelVariableRequester
    ) {
        this.variableRequesters.set(PYTHON_LANGUAGE, pythonVariableRequester);
    }

    public get refreshRequired(): Event<void> {
        return this.refreshEventEmitter.event;
    }

    // IJupyterVariables implementation
    public async getVariables(
        request: IJupyterVariablesRequest,
        notebook: INotebook
    ): Promise<IJupyterVariablesResponse> {
        // Run the language appropriate variable fetch
        return this.getVariablesBasedOnKernel(notebook, request);
    }

    public async getMatchingVariable(
        name: string,
        notebook: INotebook,
        token?: CancellationToken
    ): Promise<IJupyterVariable | undefined> {
        // See if in the cache
        const cache = this.notebookState.get(notebook.identity);
        if (cache) {
            let match = cache.variables.find((v) => v.name === name);
            if (match && !match.value) {
                match = await this.getVariableValueFromKernel(match, notebook, token);
            }
            return match;
        } else {
            // No items in the cache yet, just ask for the names
            const variables = await this.getVariableNamesAndTypesFromKernel(notebook, token);
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
                        notebook,
                        token
                    );
                }
            }
        }
    }

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        notebook: INotebook,
        sliceExpression?: string,
        isRefresh?: boolean
    ): Promise<IJupyterVariable> {
        const languageId = getKernelConnectionLanguage(notebook?.getKernelConnection()) || PYTHON_LANGUAGE;
        const variableRequester = this.variableRequesters.get(languageId);
        if (variableRequester) {
            if (isRefresh) {
                targetVariable = await this.getFullVariable(targetVariable, notebook);
            }

            let expression = targetVariable.name;
            if (sliceExpression) {
                expression = `${targetVariable.name}${sliceExpression}`;
            }
            return variableRequester.getDataFrameInfo(targetVariable, notebook, expression);
        }
        return targetVariable;
    }

    public async getDataFrameRows(
        targetVariable: IJupyterVariable,
        start: number,
        end: number,
        notebook: INotebook,
        sliceExpression?: string
    ): Promise<{}> {
        const language = getKernelConnectionLanguage(notebook?.getKernelConnection()) || PYTHON_LANGUAGE;
        const variableRequester = this.variableRequesters.get(language);
        if (variableRequester) {
            let expression = targetVariable.name;
            if (sliceExpression) {
                expression = `${targetVariable.name}${sliceExpression}`;
            }
            return variableRequester.getDataFrameRows(start, end, notebook, expression);
        }
        return {};
    }

    public async getFullVariable(
        targetVariable: IJupyterVariable,
        notebook: INotebook,
        token?: CancellationToken
    ): Promise<IJupyterVariable> {
        const languageId = getKernelConnectionLanguage(notebook?.getKernelConnection()) || PYTHON_LANGUAGE;
        const variableRequester = this.variableRequesters.get(languageId);
        if (variableRequester) {
            return variableRequester.getFullVariable(targetVariable, notebook, token);
        }
        return targetVariable;
    }

    private async getVariablesBasedOnKernel(
        notebook: INotebook,
        request: IJupyterVariablesRequest
    ): Promise<IJupyterVariablesResponse> {
        // See if we already have the name list
        let list = this.notebookState.get(notebook.identity);
        if (!list || list.currentExecutionCount !== request.executionCount) {
            // Refetch the list of names from the notebook. They might have changed.
            list = {
                currentExecutionCount: request.executionCount,
                variables: (await this.getVariableNamesAndTypesFromKernel(notebook)).map((v) => {
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

        const exclusionList = this.configService.getSettings(notebook.resource).variableExplorerExclude
            ? this.configService.getSettings().variableExplorerExclude?.split(';')
            : [];

        const result: IJupyterVariablesResponse = {
            executionCount: request.executionCount,
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
                const fullVariable = list.variables[i].value
                    ? list.variables[i]
                    : await this.getVariableValueFromKernel(list.variables[i], notebook);

                // See if this is excluded or not.
                if (exclusionList && exclusionList.indexOf(fullVariable.type) >= 0) {
                    // Not part of our actual list. Remove from the real list too
                    list.variables.splice(i, 1);
                } else {
                    list.variables[i] = fullVariable;
                    result.pageResponse.push(fullVariable);
                    i += 1;
                }
            }

            // Save in our cache
            this.notebookState.set(notebook.identity, list);

            // Update total count (exclusions will change this as types are computed)
            result.totalCount = list.variables.length;
        }

        return result;
    }

    public async getVariableProperties(
        word: string,
        notebook: INotebook,
        cancelToken: CancellationToken | undefined
    ): Promise<{ [attributeName: string]: string }> {
        const matchingVariable = await this.getMatchingVariable(word, notebook, cancelToken);
        const settings = this.configService.getSettings().variableTooltipFields;
        const languageId = getKernelConnectionLanguage(notebook?.getKernelConnection()) || PYTHON_LANGUAGE;
        const languageSettings = settings[languageId];
        const inEnhancedTooltipsExperiment = await this.inEnhancedTooltipsExperiment();

        const variableRequester = this.variableRequesters.get(languageId);
        if (variableRequester) {
            return variableRequester.getVariableProperties(
                word,
                notebook,
                cancelToken,
                matchingVariable,
                languageSettings,
                inEnhancedTooltipsExperiment
            );
        }

        return {};
    }

    private async getVariableNamesAndTypesFromKernel(
        notebook: INotebook,
        token?: CancellationToken
    ): Promise<IJupyterVariable[]> {
        // Get our query and parser
        const languageId = getKernelConnectionLanguage(notebook?.getKernelConnection()) || PYTHON_LANGUAGE;
        const variableRequester = this.variableRequesters.get(languageId);
        if (variableRequester) {
            return variableRequester.getVariableNamesAndTypesFromKernel(notebook, token);
        }

        return [];
    }

    // eslint-disable-next-line complexity
    private async getVariableValueFromKernel(
        targetVariable: IJupyterVariable,
        notebook: INotebook,
        token?: CancellationToken
    ): Promise<IJupyterVariable> {
        let result = { ...targetVariable };
        if (notebook) {
            const output = await notebook.inspect(targetVariable.name, 0, token);

            // Should be a text/plain inside of it (at least IPython does this)
            if (output && output.hasOwnProperty('text/plain')) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const text = (output as any)['text/plain'].toString();

                // Parse into bits
                const type = TypeRegex.exec(text);
                const value = ValueRegex.exec(text);
                const stringForm = StringFormRegex.exec(text);
                const docString = DocStringRegex.exec(text);
                const count = CountRegex.exec(text);
                const shape = ShapeRegex.exec(text);
                if (type) {
                    result.type = type[1];
                }
                if (value) {
                    result.value = value[1];
                } else if (stringForm) {
                    result.value = stringForm[1];
                } else if (docString) {
                    result.value = docString[1];
                } else {
                    result.value = '';
                }
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
            isPythonKernelConnection(notebook.getKernelConnection()) &&
            result.supportsDataExplorer &&
            result.type !== 'list' // List count is good enough
        ) {
            result = await this.getFullVariable(result, notebook);
        }

        return result;
    }

    private async inEnhancedTooltipsExperiment() {
        if (!this.enhancedTooltipsExperimentPromise) {
            this.enhancedTooltipsExperimentPromise = await this.experimentService.inExperiment(
                Experiments.EnhancedTooltips
            );
        }
        return this.enhancedTooltipsExperimentPromise;
    }
}
