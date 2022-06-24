// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IFileSystem } from './platform/types';
import { IDataFrameScriptGenerator, IExtensionContext } from './types';
import { joinPath } from '../vscode-path/resources';
import * as dedent from 'dedent';

const DataFrameFunc = '_VSCODE_getDataFrame';
const cleanupCode = dedent`
                            try:
                                del _VSCODE_getDataFrame
                            except:
                                pass
                            `;
@injectable()
export class DataFrameScriptGenerator implements IDataFrameScriptGenerator {
    constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}
    public async generateCodeToGetDataFrameInfo(options: { variableName: string }) {
        const contents = await this.getContentsOfDataFrameScript();
        return `${contents}\n\n(${DataFrameFunc}("info", ${options.variableName}))\n\n${cleanupCode}`;
    }
    public async generateCodeToGetDataFrameRows(options: {
        variableName: string;
        startIndex: number;
        endIndex: number;
    }) {
        const contents = await this.getContentsOfDataFrameScript();
        return `${contents}\n\n${DataFrameFunc}("rows", ${options.variableName}, ${options.startIndex}, ${options.endIndex})\n\n${cleanupCode}`;
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
