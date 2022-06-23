// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IFileSystem } from './platform/types';
import { IDataFrameScriptGenerator, IExtensionContext } from './types';
import { joinPath } from '../vscode-path/resources';

const DataFrameInfoFunc = '_VSCODE_getDataFrameInfo';
const DataFrameRowFunc = '_VSCODE_getDataFrameRows';
@injectable()
export class DataFrameScriptGenerator implements IDataFrameScriptGenerator {
    constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}
    public async generateCodeToGetDataFrameInfo(options: { isDebugging: boolean; variableName: string }) {
        const contents = await this.getContentsOfDataFrameScript();
        if (options.isDebugging) {
            return `${contents}\n\n${DataFrameInfoFunc}(${options.variableName})`;
        } else {
            return `import builtins\nbuiltins.print(${DataFrameInfoFunc}(${options.variableName}))`;
        }
    }
    public async generateCodeToGetDataFrameRows(options: {
        isDebugging: boolean;
        variableName: string;
        startIndex: number;
        endIndex: number;
    }) {
        const contents = await this.getContentsOfDataFrameScript();
        if (options.isDebugging) {
            return `${contents}\n\n${DataFrameRowFunc}(${options.variableName}, ${options.startIndex}, ${options.endIndex})`;
        } else {
            return `import builtins\nbuiltins.print(${DataFrameRowFunc}(${options.variableName}, ${options.startIndex}, ${options.endIndex}))`;
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
