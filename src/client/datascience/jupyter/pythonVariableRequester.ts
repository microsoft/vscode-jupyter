// import { nbformat } from '@jupyterlab/coreutils';
import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import * as uuid from 'uuid/v4';
import stripAnsi from 'strip-ansi';
import { CancellationToken } from 'vscode';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IDisposable } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { GetVariableInfo, Identifiers } from '../constants';
// import * as uuid from 'uuid/v4';
// import { PYTHON_LANGUAGE } from '../../common/constants';
// import { localize } from '../../common/utils/localize';
// import { Identifiers } from '../constants';
import { ICell, IJupyterVariable, IKernelVariableRequester, INotebook } from '../types';
import { JupyterDataRateLimitError } from './jupyterDataRateLimitError';
// import { JupyterDataRateLimitError } from './jupyterDataRateLimitError';
// import { getKernelConnectionLanguage } from './kernels/helpers';

@injectable()
export class PythonVariablesRequester implements IKernelVariableRequester {
    private importedGetVariableInfoScripts = new Map<string, boolean>();

    constructor(@inject(IFileSystem) private fs: IFileSystem) {}

    public async getVariableNamesAndTypesFromKernel(
        notebook: INotebook,
        token?: CancellationToken
    ): Promise<IJupyterVariable[]> {
        // Get our query and parser
        // const language = getKernelConnectionLanguage(notebook?.getKernelConnection()) || PYTHON_LANGUAGE;
        console.log('YESSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS');
        // Now execute the query
        if (notebook || token) {
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
