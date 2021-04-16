// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import stripAnsi from 'strip-ansi';
import * as uuid from 'uuid/v4';
import * as path from 'path';
import { CancellationToken, Event, EventEmitter, Uri } from 'vscode';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { Experiments } from '../../common/experiments/groups';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IConfigurationService, IDisposable, IExperimentService } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { DataFrameLoading, GetVariableInfo, Identifiers, Settings } from '../constants';
import {
    ICell,
    IJupyterVariable,
    IJupyterVariables,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse,
    INotebook
} from '../types';
import { JupyterDataRateLimitError } from './jupyterDataRateLimitError';
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
    'EagerTensor'
]);
interface INotebookState {
    currentExecutionCount: number;
    variables: IJupyterVariable[];
}

@injectable()
export class KernelVariables implements IJupyterVariables {
    private importedDataFrameScripts = new Map<string, boolean>();
    private importedGetVariableInfoScripts = new Map<string, boolean>();
    private languageToQueryMap = new Map<string, { query: string; parser: RegExp }>();
    private notebookState = new Map<Uri, INotebookState>();
    private refreshEventEmitter = new EventEmitter<void>();
    private enhancedTooltipsExperimentPromise: boolean | undefined;

    constructor(
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IExperimentService) private experimentService: IExperimentService
    ) { }

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
            const names = await this.getVariableNamesFromKernel(notebook, token);
            if (names) {
                const matchName = names.find((n) => n === name);
                if (matchName) {
                    return this.getVariableValueFromKernel(
                        {
                            name,
                            value: undefined,
                            supportsDataExplorer: false,
                            type: '',
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
        // Import the data frame script directory if we haven't already
        await this.importDataFrameScripts(notebook);

        if (isRefresh) {
            targetVariable = await this.getFullVariable(targetVariable, notebook);
        }

        let expression = targetVariable.name;
        if (sliceExpression) {
            expression = `${targetVariable.name}${sliceExpression}`;
        }

        // Then execute a call to get the info and turn it into JSON
        const results = await notebook.execute(
            `print(${DataFrameLoading.DataFrameInfoFunc}(${expression}))`,
            Identifiers.EmptyFileName,
            0,
            uuid(),
            undefined,
            true
        );

        const fileName = path.basename(notebook.identity.path);

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results),
            fileName
        };
    }

    public async getDataFrameRows(
        targetVariable: IJupyterVariable,
        start: number,
        end: number,
        notebook: INotebook,
        sliceExpression?: string
    ): Promise<{}> {
        // Import the data frame script directory if we haven't already
        await this.importDataFrameScripts(notebook);

        let expression = targetVariable.name;
        if (sliceExpression) {
            expression = `${targetVariable.name}${sliceExpression}`;
        }

        // Then execute a call to get the rows and turn it into JSON
        const results = await notebook.execute(
            `print(${DataFrameLoading.DataFrameRowFunc}(${expression}, ${start}, ${end}))`,
            Identifiers.EmptyFileName,
            0,
            uuid(),
            undefined,
            true
        );
        return this.deserializeJupyterResult(results);
    }

    public async getDataFrameColumn(
        targetVariable: IJupyterVariable,
        columnName: string,
        notebook: INotebook
    ): Promise<{}> {
        // Import the data frame script directory if we haven't already
        await this.importDataFrameScripts(notebook);

        let expression = targetVariable.name;

        // Then execute a call to get the rows and turn it into JSON
        const results = await notebook.execute(
            //TODO CHANGE THIS
            `print(${DataFrameLoading.DataFrameColFunc}(${expression}, '${columnName}'))`,
            Identifiers.EmptyFileName,
            0,
            uuid(),
            undefined,
            true
        );

        return this.deserializeJupyterResult(results);
    }

    private async importDataFrameScripts(notebook: INotebook, token?: CancellationToken): Promise<void> {
        const key = notebook.identity.toString();
        if (!this.importedDataFrameScripts.get(key)) {
            // Clear our flag if the notebook disposes or restarts
            const disposables: IDisposable[] = [];
            const handler = () => {
                this.importedDataFrameScripts.delete(key);
                disposables.forEach((d) => d.dispose());
            };
            disposables.push(notebook.onDisposed(handler));
            disposables.push(notebook.onKernelChanged(handler));
            disposables.push(notebook.onKernelRestarted(handler));

            // First put the code from our helper files into the notebook
            await this.runScriptFile(notebook, DataFrameLoading.ScriptPath, token);

            this.importedDataFrameScripts.set(notebook.identity.toString(), true);
        }
    }

    private async importGetVariableInfoScripts(notebook: INotebook, token?: CancellationToken): Promise<void> {
        const key = notebook.identity.toString();
        if (!this.importedGetVariableInfoScripts.get(key)) {
            // Clear our flag if the notebook disposes or restarts
            const disposables: IDisposable[] = [];
            const handler = () => {
                this.importedGetVariableInfoScripts.delete(key);
                disposables.forEach((d) => d.dispose());
            };
            disposables.push(notebook.onDisposed(handler));
            disposables.push(notebook.onKernelChanged(handler));
            disposables.push(notebook.onKernelRestarted(handler));

            await this.runScriptFile(notebook, GetVariableInfo.ScriptPath, token);

            this.importedGetVariableInfoScripts.set(notebook.identity.toString(), true);
        }
    }

    // Read in a .py file and execute it silently in the given notebook
    private async runScriptFile(notebook: INotebook, scriptFile: string, token?: CancellationToken) {
        if (await this.fs.localFileExists(scriptFile)) {
            const fileContents = await this.fs.readLocalFile(scriptFile);
            return notebook.execute(fileContents, Identifiers.EmptyFileName, 0, uuid(), token, true);
        } else {
            traceError('Cannot run non-existant script file');
        }
    }

    public async getFullVariable(
        targetVariable: IJupyterVariable,
        notebook: INotebook,
        token?: CancellationToken
    ): Promise<IJupyterVariable> {
        // Add in our get variable info script
        await this.importGetVariableInfoScripts(notebook, token);

        // Then execute a call to get the info and turn it into JSON
        const results = await notebook.execute(
            `print(${GetVariableInfo.VariableInfoFunc}(${targetVariable.name}))`,
            Identifiers.EmptyFileName,
            0,
            uuid(),
            token,
            true
        );

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results)
        };
    }

    private extractJupyterResultText(cells: ICell[]): string {
        // Verify that we have the correct cell type and outputs
        if (cells.length > 0 && cells[0].data) {
            const codeCell = cells[0].data as nbformat.ICodeCell;
            if (codeCell.outputs.length > 0) {
                const codeCellOutput = codeCell.outputs[0] as nbformat.IOutput;
                if (
                    codeCellOutput &&
                    codeCellOutput.output_type === 'stream' &&
                    codeCellOutput.name === 'stderr' &&
                    codeCellOutput.hasOwnProperty('text')
                ) {
                    const resultString = codeCellOutput.text as string;
                    // See if this the IOPUB data rate limit problem
                    if (resultString.includes('iopub_data_rate_limit')) {
                        throw new JupyterDataRateLimitError();
                    } else {
                        const error = localize.DataScience.jupyterGetVariablesExecutionError().format(resultString);
                        traceError(error);
                        throw new Error(error);
                    }
                }
                if (codeCellOutput && codeCellOutput.output_type === 'execute_result') {
                    const data = codeCellOutput.data;
                    if (data && data.hasOwnProperty('text/plain')) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        return (data as any)['text/plain'];
                    }
                }
                if (
                    codeCellOutput &&
                    codeCellOutput.output_type === 'stream' &&
                    codeCellOutput.hasOwnProperty('text')
                ) {
                    return codeCellOutput.text as string;
                }
                if (
                    codeCellOutput &&
                    codeCellOutput.output_type === 'error' &&
                    codeCellOutput.hasOwnProperty('traceback')
                ) {
                    const traceback: string[] = codeCellOutput.traceback as string[];
                    const stripped = traceback.map(stripAnsi).join('\r\n');
                    const error = localize.DataScience.jupyterGetVariablesExecutionError().format(stripped);
                    traceError(error);
                    throw new Error(error);
                }
            }
        }

        throw new Error(localize.DataScience.jupyterGetVariablesBadResults());
    }

    // Pull our text result out of the Jupyter cell
    private deserializeJupyterResult<T>(cells: ICell[]): T {
        const text = this.extractJupyterResultText(cells);
        return JSON.parse(text) as T;
    }

    private getParser(notebook: INotebook) {
        // Figure out kernel language
        const language = getKernelConnectionLanguage(notebook?.getKernelConnection()) || PYTHON_LANGUAGE;

        // We may have cached this information
        let result = this.languageToQueryMap.get(language);
        if (!result) {
            let query = this.configService
                .getSettings(notebook.resource)
                .variableQueries.find((v) => v.language === language);
            if (!query && language === PYTHON_LANGUAGE) {
                query = Settings.DefaultVariableQuery;
            }

            // Use the query to generate our regex
            if (query) {
                result = {
                    query: query.query,
                    parser: new RegExp(query.parseExpr, 'g')
                };
                this.languageToQueryMap.set(language, result);
            }
        }

        return result;
    }

    private getAllMatches(regex: RegExp, text: string): string[] {
        const result: string[] = [];
        let m: RegExpExecArray | null = null;
        // eslint-disable-next-line no-cond-assign
        while ((m = regex.exec(text)) !== null) {
            if (m.index === regex.lastIndex) {
                regex.lastIndex += 1;
            }
            if (m.length > 1) {
                result.push(m[1]);
            }
        }
        // Rest after searching
        regex.lastIndex = -1;
        return result;
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
                variables: (await this.getVariableNamesFromKernel(notebook)).map((n) => {
                    return {
                        name: n,
                        value: undefined,
                        supportsDataExplorer: false,
                        type: '',
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
            const startPos = request.startIndex ? request.startIndex : 0;
            const chunkSize = request.pageSize ? request.pageSize : 100;
            result.pageStartIndex = startPos;

            // Do one at a time. All at once doesn't work as they all have to wait for each other anyway
            for (let i = startPos; i < startPos + chunkSize && i < list.variables.length;) {
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
        const type = matchingVariable?.type;
        let result: { [attributeName: string]: string } = {};
        if (matchingVariable && matchingVariable.value) {
            if (type && type in languageSettings && (await this.inEnhancedTooltipsExperiment())) {
                const attributeNames = languageSettings[type];
                const stringifiedAttributeNameList =
                    '[' + attributeNames.reduce((accumulator, currVal) => accumulator + `"${currVal}", `, '') + ']';
                const attributes = await notebook.execute(
                    `print(${GetVariableInfo.VariablePropertiesFunc}(${matchingVariable.name}, ${stringifiedAttributeNameList}))`,
                    Identifiers.EmptyFileName,
                    0,
                    uuid(),
                    cancelToken,
                    true
                );
                result = { ...result, ...this.deserializeJupyterResult(attributes) };
            } else {
                result[`${word}`] = matchingVariable.value;
            }
        }
        return result;
    }

    private async getVariableNamesFromKernel(notebook: INotebook, token?: CancellationToken): Promise<string[]> {
        // Get our query and parser
        const query = this.getParser(notebook);

        // Now execute the query
        if (notebook && query) {
            const cells = await notebook.execute(query.query, Identifiers.EmptyFileName, 0, uuid(), token, true);
            const text = this.extractJupyterResultText(cells);

            // Apply the expression to it
            const matches = this.getAllMatches(query.parser, text);

            // Turn each match into a value
            if (matches) {
                return matches;
            }
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
