import { inject } from 'inversify';
import * as path from '../vscode-path/path';
import { IExtensionContext, IScriptPathUtils } from './types';

export class ScriptPathUtils implements IScriptPathUtils {
    constructor(@inject(IExtensionContext) private readonly context: IExtensionContext) {}

    get dataFrameLoading() {
        const sysPath = path.join(
            this.context.extensionPath,
            'pythonFiles',
            'vscode_datascience_helpers',
            'dataframes'
        );
        const dataFrameImport = `__import__('vscodeDataFrame')`;
        return {
            dataFrameSysImport: `import sys\nsys.path.append("${sysPath.replace(/\\/g, '\\\\')}")`,
            scriptPath: path.join(sysPath, 'vscodeDataFrame.py'),
            dataFrameInfoFunc: '_VSCODE_getDataFrameInfo',
            dataFrameRowFunc: '_VSCODE_getDataFrameRows',
            dataFrameInfoImportFunc: `${dataFrameImport}._VSCODE_getDataFrameInfo`,
            dataFrameRowImportFunc: `${dataFrameImport}._VSCODE_getDataFrameRows`
        };
    }

    get getVariableInfo() {
        const sysPath = path.join(
            this.context.extensionPath,
            'pythonFiles',
            'vscode_datascience_helpers',
            'getVariableInfo'
        );
        const variableInfoImportName = `__import__('vscodeGetVariableInfo')`;
        return {
            getVariableInfoSysImport: `import sys\nsys.path.append("${sysPath.replace(/\\/g, '\\\\')}")`,
            scriptPath: path.join(sysPath, 'vscodeGetVariableInfo.py'),
            variableInfoFunc: '_VSCODE_getVariableInfo',
            variablePropertiesFunc: '_VSCODE_getVariableProperties',
            variableTypesFunc: '_VSCODE_getVariableTypes',
            variableInfoImportFunc: `${variableInfoImportName}._VSCODE_getVariableInfo`
        };
    }

    get addRunCellHook() {
        const sysPath = path.join(this.context.extensionPath, 'pythonFiles', 'vscode_datascience_helpers', 'kernel');
        return {
            scriptPath: path.join(sysPath, 'addRunCellHook.py')
        };
    }
}
