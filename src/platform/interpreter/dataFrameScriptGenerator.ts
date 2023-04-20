// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IFileSystem } from '../common/platform/types';
import { IDataFrameScriptGenerator, IExtensionContext } from '../common/types';
import { joinPath } from '../vscode-path/resources';
import dedent from 'dedent';

const DataFrameFunc = '_VSCODE_getDataFrame';
const cleanupCode = dedent`
                            try:
                                del _VSCODE_getDataFrame
                            except:
                                pass
                            `;

/**
 * Provides utilities to extrace the dataframe python scripts from the extension installation. These scripts can then be used to query dataframes in the kernel.
 */
@injectable()
export class DataFrameScriptGenerator implements IDataFrameScriptGenerator {
    constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}
    public async generateCodeToGetDataFrameInfo(options: { isDebugging: boolean; variableName: string }) {
        const initializeCode = await this.getContentsOfDataFrameScript();
        const isDebugging = options.isDebugging ? 'True' : 'False';
        const code = `${DataFrameFunc}("info", ${isDebugging}, ${options.variableName})`;
        if (options.isDebugging) {
            // When debugging, the code is evaluated in the debugger, so we need to initialize the script.
            // We cannot send complex code to the debugger, it has to be a simple expression that produces a value.
            // Hence the need to split the code into initialization, real code & finalization.
            return {
                initializeCode,
                code,
                cleanupCode
            };
        } else {
            return {
                code: `${initializeCode}\n\n${code}\n\n${cleanupCode}`
            };
        }
    }
    public async generateCodeToGetDataFrameRows(options: {
        isDebugging: boolean;
        variableName: string;
        startIndex: number;
        endIndex: number;
    }) {
        const initializeCode = await this.getContentsOfDataFrameScript();
        const isDebugging = options.isDebugging ? 'True' : 'False';
        const code = `${DataFrameFunc}("rows", ${isDebugging}, ${options.variableName}, ${options.startIndex}, ${options.endIndex})`;
        if (options.isDebugging) {
            return {
                initializeCode,
                code,
                cleanupCode
            };
        } else {
            return {
                code: `${initializeCode}\n\n${code}\n\n${cleanupCode}`
            };
        }
    }

    static contentsOfDataFrameScript: string | undefined;
    private async getContentsOfDataFrameScript() {
        if (DataFrameScriptGenerator.contentsOfDataFrameScript) {
            return DataFrameScriptGenerator.contentsOfDataFrameScript;
        }
        const scriptPath = joinPath(
            this.context.extensionUri,
            'pythonFiles',
            'vscode_datascience_helpers',
            'dataframes',
            'vscodeDataFrame.py'
        );
        const contents = await this.fs.readFile(scriptPath);
        DataFrameScriptGenerator.contentsOfDataFrameScript = contents;
        return contents;
    }
}
