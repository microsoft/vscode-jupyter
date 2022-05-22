import { inject } from 'inversify';
import * as path from '../vscode-path/path';
import { IExtensionContext, IScriptPathUtils } from './types';

export class ScriptPathUtils implements IScriptPathUtils {
    constructor(@inject(IExtensionContext) private readonly context: IExtensionContext) {}

    get rootDirectory() {
        return this.context.extensionPath;
    }

    get DataFrameLoading() {
        const SysPath = path.join(this.rootDirectory, 'pythonFiles', 'vscode_datascience_helpers', 'dataframes');
        const DataFrameImport = `__import__('vscodeDataFrame')`;
        return {
            SysPath,
            DataFrameSysImport: `import sys\nsys.path.append("${SysPath.replace(/\\/g, '\\\\')}")`,
            ScriptPath: path.join(SysPath, 'vscodeDataFrame.py'),
            DataFrameInfoFunc: '_VSCODE_getDataFrameInfo',
            DataFrameRowFunc: '_VSCODE_getDataFrameRows',
            // Constants for the debugger which imports the script files
            DataFrameImport,
            DataFrameInfoImportFunc: `${DataFrameImport}._VSCODE_getDataFrameInfo`,
            DataFrameRowImportFunc: `${DataFrameImport}._VSCODE_getDataFrameRows`
        };
    }

    get GetVariableInfo() {
        const SysPath = path.join(this.rootDirectory, 'pythonFiles', 'vscode_datascience_helpers', 'getVariableInfo');
        const VariableInfoImportName = `__import__('vscodeGetVariableInfo')`;
        return {
            SysPath,
            GetVariableInfoSysImport: `import sys\nsys.path.append("${SysPath.replace(/\\/g, '\\\\')}")`,
            ScriptPath: path.join(SysPath, 'vscodeGetVariableInfo.py'),
            VariableInfoFunc: '_VSCODE_getVariableInfo',
            VariablePropertiesFunc: '_VSCODE_getVariableProperties',
            VariableTypesFunc: '_VSCODE_getVariableTypes',

            // Constants for the debugger which imports the script files
            VariableInfoImportName,
            VariableInfoImportFunc: `${VariableInfoImportName}._VSCODE_getVariableInfo`
        };
    }

    get AddRunCellHook() {
        const SysPath = path.join(this.rootDirectory, 'pythonFiles', 'vscode_datascience_helpers', 'kernel');
        return {
            SysPath,
            ScriptPath: path.join(SysPath, 'addRunCellHook.py')
        };
    }
}
