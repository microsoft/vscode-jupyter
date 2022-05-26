import { IDisposable } from '@fluentui/react';
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookDocument, Uri } from 'vscode';
import { traceError } from '../../platform/logging';
import { IFileSystem } from '../../platform/common/platform/types';
import { DataScience } from '../../platform/common/utils/localize';
import { stripAnsi } from '../../platform/common/utils/regexp';
import { JupyterDataRateLimitError } from '../../platform/errors/jupyterDataRateLimitError';
import { Telemetry } from '../../webviews/webview-side/common/constants';
import { executeSilently } from '../helpers';
import { IKernel } from '../types';
import { IKernelVariableRequester, IJupyterVariable } from './types';
import { getAssociatedNotebookDocument } from '../../notebooks/controllers/kernelSelector';
import { DataFrameLoading, GetVariableInfo } from '../../platform/common/scriptConstants';
import { joinPath } from '../../platform/vscode-path/resources';
import { IExtensionContext } from '../../platform/common/types';

type DataFrameSplitFormat = {
    index: (number | string)[];
    columns: string[];
    data: Record<string, unknown>[];
};

export function parseDataFrame(df: DataFrameSplitFormat) {
    const rowIndexValues = df.index;
    const columns = df.columns;
    const rowData = df.data;
    const data = rowData.map((row, index) => {
        const rowData: Record<string, unknown> = {
            index: rowIndexValues[index]
        };
        columns.forEach((column, columnIndex) => {
            rowData[column] = row[columnIndex];
        });
        return rowData;
    });
    return { data };
}

@injectable()
export class PythonVariablesRequester implements IKernelVariableRequester {
    private importedDataFrameScripts = new WeakMap<NotebookDocument, boolean>();
    private importedGetVariableInfoScripts = new WeakMap<NotebookDocument, boolean>();

    constructor(
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        expression: string
    ): Promise<IJupyterVariable> {
        // Import the data frame script directory if we haven't already
        await this.importDataFrameScripts(kernel);

        // Then execute a call to get the info and turn it into JSON
        const results = kernel.session
            ? await executeSilently(
                  kernel.session,
                  `import builtins\nbuiltins.print(${DataFrameLoading.DataFrameInfoFunc}(${expression}))`,
                  {
                      traceErrors: true,
                      traceErrorsMessage: 'Failure in execute_request for getDataFrameInfo',
                      telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                  }
              )
            : [];

        const fileName = getAssociatedNotebookDocument(kernel)?.uri || kernel.resourceUri || kernel.id;

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results),
            fileName
        };
    }

    public async getDataFrameRows(
        start: number,
        end: number,
        kernel: IKernel,
        expression: string
    ): Promise<{ data: Record<string, unknown>[] }> {
        await this.importDataFrameScripts(kernel);

        // Then execute a call to get the rows and turn it into JSON
        const results = kernel.session
            ? await executeSilently(
                  kernel.session,
                  `import builtins\nbuiltins.print(${DataFrameLoading.DataFrameRowFunc}(${expression}, ${start}, ${end}))`,
                  {
                      traceErrors: true,
                      traceErrorsMessage: 'Failure in execute_request for getDataFrameRows',
                      telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                  }
              )
            : [];

        return parseDataFrame(this.deserializeJupyterResult<DataFrameSplitFormat>(results));
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
                          `import builtins\nbuiltins.print(${GetVariableInfo.VariablePropertiesFunc}(${matchingVariable.name}, ${stringifiedAttributeNameList}))`,
                          {
                              traceErrors: true,
                              traceErrorsMessage: 'Failure in execute_request for getVariableProperties',
                              telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                          }
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
                      `import builtins\n_rwho_ls = %who_ls\nbuiltins.print(${GetVariableInfo.VariableTypesFunc}(_rwho_ls))`,
                      {
                          traceErrors: true,
                          traceErrorsMessage: 'Failure in execute_request for getVariableNamesAndTypesFromKernel',
                          telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                      }
                  )
                : [];

            if (kernel.disposed || kernel.disposing) {
                return [];
            }
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
                  `import builtins\nbuiltins.print(${GetVariableInfo.VariableInfoFunc}(${targetVariable.name}))`,
                  {
                      traceErrors: true,
                      traceErrorsMessage: 'Failure in execute_request for getFullVariable',
                      telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                  }
              )
            : [];

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results)
        };
    }

    private async importDataFrameScripts(kernel: IKernel): Promise<void> {
        const key = getAssociatedNotebookDocument(kernel);
        if (key && !this.importedDataFrameScripts.get(key)) {
            // Clear our flag if the notebook disposes or restarts
            const disposables: IDisposable[] = [];
            const handler = () => {
                this.importedDataFrameScripts.delete(key);
                disposables.forEach((d) => d.dispose());
            };
            disposables.push(kernel.onDisposed(handler));
            disposables.push(kernel.onRestarted(handler));

            // First put the code from our helper files into the notebook
            await this.runScriptFile(kernel, joinPath(this.context.extensionUri, DataFrameLoading.ScriptPath));

            this.importedDataFrameScripts.set(key, true);
        }
    }

    private async importGetVariableInfoScripts(kernel: IKernel): Promise<void> {
        const key = getAssociatedNotebookDocument(kernel);
        if (key && !this.importedGetVariableInfoScripts.get(key)) {
            // Clear our flag if the notebook disposes or restarts
            const disposables: IDisposable[] = [];
            const handler = () => {
                this.importedGetVariableInfoScripts.delete(key);
                disposables.forEach((d) => d.dispose());
            };
            disposables.push(kernel.onDisposed(handler));
            disposables.push(kernel.onRestarted(handler));

            await this.runScriptFile(kernel, joinPath(this.context.extensionUri, GetVariableInfo.ScriptPath));

            this.importedGetVariableInfoScripts.set(key, true);
        }
    }

    // Read in a .py file and execute it silently in the given notebook
    private async runScriptFile(kernel: IKernel, scriptFile: Uri) {
        if (await this.fs.exists(scriptFile)) {
            const fileContents = await this.fs.readFile(scriptFile);
            return kernel.session ? executeSilently(kernel.session, fileContents) : [];
        }
        traceError('Cannot run non-existent script file');
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
                    const error = DataScience.jupyterGetVariablesExecutionError().format(resultString);
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
                const error = DataScience.jupyterGetVariablesExecutionError().format(stripped);
                traceError(error);
                throw new Error(error);
            }
        }

        throw new Error(DataScience.jupyterGetVariablesBadResults());
    }

    // Pull our text result out of the Jupyter cell
    private deserializeJupyterResult<T>(outputs: nbformat.IOutput[]): T {
        const text = this.extractJupyterResultText(outputs);
        return JSON.parse(text) as T;
    }
}
