// import type * as nbformat from '@jupyterlab/nbformat';
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import stripAnsi from 'strip-ansi';
import { CancellationToken, NotebookDocument } from 'vscode';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IDisposable } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { DataFrameLoading, GetVariableInfo } from '../constants';
import { IJupyterVariable, IKernelVariableRequester } from '../types';
import { JupyterDataRateLimitError } from '../errors/jupyterDataRateLimitError';
import { executeSilently } from './kernels/kernel';
import { IKernel } from './kernels/types';

@injectable()
export class PythonVariablesRequester implements IKernelVariableRequester {
    private importedDataFrameScripts = new WeakMap<NotebookDocument, boolean>();
    private importedGetVariableInfoScripts = new WeakMap<NotebookDocument, boolean>();

    constructor(@inject(IFileSystem) private fs: IFileSystem) {}

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        expression: string
    ): Promise<IJupyterVariable> {
        // Import the data frame script directory if we haven't already
        await this.importDataFrameScripts(kernel);

        // Then execute a call to get the info and turn it into JSON
        const results = kernel.session
            ? await executeSilently(kernel.session, `print(${DataFrameLoading.DataFrameInfoFunc}(${expression}))`)
            : [];

        const fileName = path.basename(kernel.notebookDocument.uri.path);

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results),
            fileName
        };
    }

    public async getDataFrameRows(start: number, end: number, kernel: IKernel, expression: string): Promise<{}> {
        await this.importDataFrameScripts(kernel);

        // Then execute a call to get the rows and turn it into JSON
        const results = kernel.session
            ? await executeSilently(
                  kernel.session,
                  `print(${DataFrameLoading.DataFrameRowFunc}(${expression}, ${start}, ${end}))`
              )
            : [];

        return this.deserializeJupyterResult(results);
    }

    public async getVariableProperties(
        word: string,
        kernel: IKernel,
        _cancelToken: CancellationToken | undefined,
        matchingVariable: IJupyterVariable | undefined,
        languageSettings: { [typeNameKey: string]: string[] },
        inEnhancedTooltipsExperiment: boolean
    ): Promise<{ [attributeName: string]: string }> {
        // Import the variable info script directory if we haven't already
        await this.importGetVariableInfoScripts(kernel);

        let result: { [attributeName: string]: string } = {};
        if (matchingVariable && matchingVariable.value) {
            const type = matchingVariable?.type;
            if (type && type in languageSettings && inEnhancedTooltipsExperiment) {
                const attributeNames = languageSettings[type];
                const stringifiedAttributeNameList =
                    '[' + attributeNames.reduce((accumulator, currVal) => accumulator + `"${currVal}", `, '') + ']';
                const attributes = kernel.session
                    ? await executeSilently(
                          kernel.session,
                          `print(${GetVariableInfo.VariablePropertiesFunc}(${matchingVariable.name}, ${stringifiedAttributeNameList}))`
                      )
                    : [];
                result = { ...result, ...this.deserializeJupyterResult(attributes) };
            } else {
                result[`${word}`] = matchingVariable.value;
            }
        }
        return result;
    }

    public async getVariableNamesAndTypesFromKernel(
        kernel: IKernel,
        _token?: CancellationToken
    ): Promise<IJupyterVariable[]> {
        if (kernel.session) {
            // Add in our get variable info script to get types
            await this.importGetVariableInfoScripts(kernel);

            // VariableTypesFunc takes in list of vars and the corresponding var names
            const results = kernel.session
                ? await executeSilently(
                      kernel.session,
                      `_rwho_ls = %who_ls\nprint(${GetVariableInfo.VariableTypesFunc}(_rwho_ls))`
                  )
                : [];

            const varNameTypeMap = this.deserializeJupyterResult(results) as Map<String, String>;

            const vars = [];
            for (const [name, type] of Object.entries(varNameTypeMap)) {
                const v: IJupyterVariable = {
                    name: name,
                    value: undefined,
                    supportsDataExplorer: false,
                    type: type || '',
                    size: 0,
                    shape: '',
                    count: 0,
                    truncated: true
                };
                vars.push(v);
            }
            return vars;
        }

        return [];
    }

    public async getFullVariable(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        _token?: CancellationToken
    ): Promise<IJupyterVariable> {
        // Import the variable info script directory if we haven't already
        await this.importGetVariableInfoScripts(kernel);

        // Then execute a call to get the info and turn it into JSON
        const results = kernel.session
            ? await executeSilently(
                  kernel.session,
                  `print(${GetVariableInfo.VariableInfoFunc}(${targetVariable.name}))`
              )
            : [];

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results)
        };
    }

    private async importDataFrameScripts(kernel: IKernel): Promise<void> {
        const key = kernel.notebookDocument;
        if (!this.importedDataFrameScripts.get(key)) {
            // Clear our flag if the notebook disposes or restarts
            const disposables: IDisposable[] = [];
            const handler = () => {
                this.importedDataFrameScripts.delete(key);
                disposables.forEach((d) => d.dispose());
            };
            disposables.push(kernel.onDisposed(handler));
            disposables.push(kernel.onRestarted(handler));

            // First put the code from our helper files into the notebook
            await this.runScriptFile(kernel, DataFrameLoading.ScriptPath);

            this.importedDataFrameScripts.set(kernel.notebookDocument, true);
        }
    }

    private async importGetVariableInfoScripts(kernel: IKernel): Promise<void> {
        const key = kernel.notebookDocument;
        if (!this.importedGetVariableInfoScripts.get(key)) {
            // Clear our flag if the notebook disposes or restarts
            const disposables: IDisposable[] = [];
            const handler = () => {
                this.importedGetVariableInfoScripts.delete(key);
                disposables.forEach((d) => d.dispose());
            };
            disposables.push(kernel.onDisposed(handler));
            disposables.push(kernel.onRestarted(handler));

            await this.runScriptFile(kernel, GetVariableInfo.ScriptPath);

            this.importedGetVariableInfoScripts.set(kernel.notebookDocument, true);
        }
    }

    // Read in a .py file and execute it silently in the given notebook
    private async runScriptFile(kernel: IKernel, scriptFile: string) {
        if (await this.fs.localFileExists(scriptFile)) {
            const fileContents = await this.fs.readLocalFile(scriptFile);
            return kernel.session ? executeSilently(kernel.session, fileContents) : [];
        }
        traceError('Cannot run non-existant script file');
    }

    private extractJupyterResultText(outputs: nbformat.IOutput[]): string {
        // Verify that we have the correct cell type and outputs
        if (outputs.length > 0) {
            const codeCellOutput = outputs[0] as nbformat.IOutput;
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
            if (codeCellOutput && codeCellOutput.output_type === 'stream' && codeCellOutput.hasOwnProperty('text')) {
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

        throw new Error(localize.DataScience.jupyterGetVariablesBadResults());
    }

    // Pull our text result out of the Jupyter cell
    private deserializeJupyterResult<T>(outputs: nbformat.IOutput[]): T {
        const text = this.extractJupyterResultText(outputs);
        return JSON.parse(text) as T;
    }
}
