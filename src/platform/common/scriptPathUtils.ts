import { inject } from 'inversify';
import * as uriPath from '../vscode-path/resources';
import { IExtensionContext, IScriptPathUtils } from './types';

export class ScriptPathUtils implements IScriptPathUtils {
    constructor(@inject(IExtensionContext) private readonly context: IExtensionContext) {}

    get dataFrameLoading() {
        const sysPath = uriPath.joinPath(
            this.context.extensionUri,
            'pythonFiles',
            'vscode_datascience_helpers',
            'dataframes'
        );
        const dataFrameImport = `__import__('vscodeDataFrame')`;
        return {
            dataFrameSysImport: `import sys\nsys.path.append("${sysPath.path.replace(/\\/g, '\\\\')}")`,
            scriptPath: uriPath.joinPath(sysPath, 'vscodeDataFrame.py'),
            dataFrameInfoFunc: '_VSCODE_getDataFrameInfo',
            dataFrameRowFunc: '_VSCODE_getDataFrameRows',
            dataFrameInfoImportFunc: `${dataFrameImport}._VSCODE_getDataFrameInfo`,
            dataFrameRowImportFunc: `${dataFrameImport}._VSCODE_getDataFrameRows`
        };
    }

    get getVariableInfo() {
        const sysPath = uriPath.joinPath(
            this.context.extensionUri,
            'pythonFiles',
            'vscode_datascience_helpers',
            'getVariableInfo'
        );
        const variableInfoImportName = `__import__('vscodeGetVariableInfo')`;
        return {
            getVariableInfoSysImport: `import sys\nsys.path.append("${sysPath.path.replace(/\\/g, '\\\\')}")`,
            scriptPath: uriPath.joinPath(sysPath, 'vscodeGetVariableInfo.py'),
            variableInfoFunc: '_VSCODE_getVariableInfo',
            variablePropertiesFunc: '_VSCODE_getVariableProperties',
            variableTypesFunc: '_VSCODE_getVariableTypes',
            variableInfoImportFunc: `${variableInfoImportName}._VSCODE_getVariableInfo`
        };
    }

    get addRunCellHook() {
        const sysPath = uriPath.joinPath(
            this.context.extensionUri,
            'pythonFiles',
            'vscode_datascience_helpers',
            'kernel'
        );
        return {
            scriptPath: uriPath.joinPath(sysPath, 'addRunCellHook.py')
        };
    }
}
