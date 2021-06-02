// import { nbformat } from '@jupyterlab/coreutils';
import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import * as uuid from 'uuid/v4';
import * as path from 'path';
import stripAnsi from 'strip-ansi';
import { CancellationToken } from 'vscode';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IDisposable } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { DataFrameLoading, GetVariableInfo, Identifiers } from '../constants';
import { ICell, IJupyterVariable, IKernelVariableRequester, INotebook } from '../types';
import { JupyterDataRateLimitError } from './jupyterDataRateLimitError';

@injectable()
export class PythonVariablesRequester implements IKernelVariableRequester {
    private importedDataFrameScripts = new Map<string, boolean>();
    private importedGetVariableInfoScripts = new Map<string, boolean>();

    constructor(@inject(IFileSystem) private fs: IFileSystem) {}

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        notebook: INotebook,
        expression: string
    ): Promise<IJupyterVariable> {
        // Import the data frame script directory if we haven't already
        await this.importDataFrameScripts(notebook);

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

    public async getDataFrameRows(start: number, end: number, notebook: INotebook, expression: string): Promise<{}> {
        await this.importDataFrameScripts(notebook);

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

    public async getVariableProperties(
        word: string,
        notebook: INotebook,
        cancelToken: CancellationToken | undefined,
        matchingVariable: IJupyterVariable | undefined,
        languageSettings: { [typeNameKey: string]: string[] },
        inEnhancedTooltipsExperiment: boolean
    ): Promise<{ [attributeName: string]: string }> {
        // Import the variable info script directory if we haven't already
        await this.importGetVariableInfoScripts(notebook, cancelToken);

        let result: { [attributeName: string]: string } = {};
        if (matchingVariable && matchingVariable.value) {
            const type = matchingVariable?.type;
            if (type && type in languageSettings && inEnhancedTooltipsExperiment) {
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

    public async getVariableNamesAndTypesFromKernel(
        notebook: INotebook,
        token?: CancellationToken
    ): Promise<IJupyterVariable[]> {
        if (notebook) {
            // Add in our get variable info script to get types
            await this.importGetVariableInfoScripts(notebook, token);

            const query = '_rwho_ls = %who_ls\nprint(_rwho_ls)';
            const parseExpr = RegExp("'(\\w+)'", 'g');

            const cells = await notebook.execute(query, Identifiers.EmptyFileName, 0, uuid(), token, true);
            const text = this.extractJupyterResultText(cells);
            const matches = this.getAllMatches(parseExpr, text);
            const matchesAsStr = matches.map((v) => `'${v}'`);

            // VariableTypesFunc takes in list of vars and the corresponding var names
            const results = await notebook.execute(
                `print(${GetVariableInfo.VariableTypesFunc}([${matches}], [${matchesAsStr}]))`,
                Identifiers.EmptyFileName,
                0,
                uuid(),
                token,
                true
            );

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
        notebook: INotebook,
        token?: CancellationToken
    ): Promise<IJupyterVariable> {
        // Import the variable info script directory if we haven't already
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
}
