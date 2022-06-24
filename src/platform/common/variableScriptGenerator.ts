// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IFileSystem } from './platform/types';
import { IExtensionContext, IVariableScriptGenerator } from './types';
import { joinPath } from '../vscode-path/resources';

const VariableInfoFunc = '_VSCODE_getVariableInfo';
const VariablePropertiesFunc = '_VSCODE_getVariableProperties';
const VariableTypesFunc = '_VSCODE_getVariableTypes';

@injectable()
export class VariableScriptGenerator implements IVariableScriptGenerator {
    static contentsOfScript: string | undefined;
    constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}
    async generateCodeToGetVariableInfo(options: { isDebugging: boolean; variableName: string }): Promise<string> {
        const contents = await this.getContentsOfScript();
        if (options.isDebugging) {
            return `${contents}\n\n${VariableInfoFunc}(${options.variableName})`;
        } else {
            return `${contents}\n\nimport builtins\nbuiltins.print(${VariableInfoFunc}(${options.variableName}))`;
        }
    }
    async generateCodeToGetVariableProperties(options: {
        variableName: string;
        stringifiedAttributeNameList: string;
    }): Promise<string> {
        const contents = await this.getContentsOfScript();
        return `${contents}\n\nimport builtins\nbuiltins.print(${VariablePropertiesFunc}(${options.variableName}, ${options.stringifiedAttributeNameList}))`;
    }
    async generateCodeToGetVariableTypes(): Promise<string> {
        const contents = await this.getContentsOfScript();
        return `${contents}\n\nimport builtins\n_rwho_ls = %who_ls\nbuiltins.print(${VariableTypesFunc}(_rwho_ls))`;
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
