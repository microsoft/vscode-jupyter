// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IFileSystem } from './platform/types';
import { IExtensionContext, IVariableScriptGenerator } from './types';
import { joinPath } from '../vscode-path/resources';
import dedent from 'dedent';

const VariableFunc = '_VSCODE_getVariable';
const cleanupCode = dedent`
                            try:
                                del _VSCODE_getVariable
                            except:
                                pass
                            `;

/**
 * Provides utilities to extract python scripts from the extension installation. These scripts can then be used to query variable information in the kernel.
 */
@injectable()
export class VariableScriptGenerator implements IVariableScriptGenerator {
    static contentsOfScript: string | undefined;
    constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}
    async generateCodeToGetVariableInfo(options: { isDebugging: boolean; variableName: string }) {
        const initializeCode = await this.getContentsOfScript();
        const isDebugging = options.isDebugging ? 'True' : 'False';
        const code = `${VariableFunc}("info", ${isDebugging}, ${options.variableName})`;
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
    async generateCodeToGetVariableProperties(options: {
        isDebugging: boolean;
        variableName: string;
        stringifiedAttributeNameList: string;
    }) {
        const initializeCode = await this.getContentsOfScript();
        const isDebugging = options.isDebugging ? 'True' : 'False';
        const code = `${VariableFunc}("properties", ${isDebugging}, ${options.variableName}, ${options.stringifiedAttributeNameList})`;
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
    async generateCodeToGetVariableTypes(options: { isDebugging: boolean }) {
        const scriptCode = await this.getContentsOfScript();
        const initializeCode = `${scriptCode}\n\n_VSCODE_rwho_ls = %who_ls\n`;
        const isDebugging = options.isDebugging ? 'True' : 'False';
        const cleanupWhoLsCode = dedent`
        try:
            del _VSCODE_rwho_ls
        except:
            pass
        `;

        const code = `${VariableFunc}("types", ${isDebugging}, _VSCODE_rwho_ls)`;
        if (options.isDebugging) {
            return {
                initializeCode,
                code,
                cleanupCode: `${cleanupCode}\n${cleanupWhoLsCode}`
            };
        } else {
            return {
                code: `${initializeCode}${code}\n\n${cleanupCode}\n${cleanupWhoLsCode}`
            };
        }
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
