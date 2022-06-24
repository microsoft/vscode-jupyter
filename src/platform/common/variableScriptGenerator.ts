// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IFileSystem } from './platform/types';
import { IExtensionContext, IVariableScriptGenerator } from './types';
import { joinPath } from '../vscode-path/resources';
import * as dedent from 'dedent';

const VariableFunc = '_VSCODE_getVariable';
const cleanupCode = dedent`
                            try:
                                del _VSCODE_getVariable
                            except:
                                pass
                            `;

@injectable()
export class VariableScriptGenerator implements IVariableScriptGenerator {
    static contentsOfScript: string | undefined;
    constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}
    async generateCodeToGetVariableInfo(options: { variableName: string }): Promise<string> {
        const contents = await this.getContentsOfScript();
        return `${contents}\n\n${VariableFunc}("info", ${options.variableName})\n\n${cleanupCode}`;
    }
    async generateCodeToGetVariableProperties(options: {
        variableName: string;
        stringifiedAttributeNameList: string;
    }): Promise<string> {
        const contents = await this.getContentsOfScript();
        return `${contents}\n\n${VariableFunc}("properties", ${options.variableName}, ${options.stringifiedAttributeNameList}))\n\n${cleanupCode}`;
    }
    async generateCodeToGetVariableTypes(): Promise<string> {
        const contents = await this.getContentsOfScript();
        const cleanupWhoLsCode = dedent`
        try:
            del _VSCODE_rwho_ls
        except:
            pass
        `;

        return `${contents}\n\n_VSCODE_rwho_ls = %who_ls\n${VariableFunc}("types",_VSCODE_rwho_ls)\n\n${cleanupCode}\n${cleanupWhoLsCode}`;
    }
    /**
     * Script content is static, hence read the contents once.
     */
    private async getContentsOfScript() {
        if (VariableScriptGenerator.contentsOfScript) {
            return VariableScriptGenerator.contentsOfScript;
        }
        const scriptPath = joinPath(
            this.context.extensionUri,
            'pythonFiles',
            'vscode_datascience_helpers',
            'getVariableInfo',
            'vscodeGetVariableInfo.py'
        );
        const contents = await this.fs.readFile(scriptPath);
        VariableScriptGenerator.contentsOfScript = contents;
        return contents;
    }
}
