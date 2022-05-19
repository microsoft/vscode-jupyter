import * as path from '../../platform/vscode-path/path';
export * from './constants';

export namespace DataFrameLoading {
    export function SysPath(rootDir: string) {
        return path.join(rootDir, 'pythonFiles', 'vscode_datascience_helpers', 'dataframes');
    }

    export function DataFrameSysImport(rootDir: string) {
        return `import sys\nsys.path.append("${SysPath(rootDir).replace(/\\/g, '\\\\')}")`;
    }

    export function ScriptPath(rootDir: string) {
        return path.join(SysPath(rootDir), 'vscodeDataFrame.py');
    }

    export const DataFrameInfoFunc = '_VSCODE_getDataFrameInfo';
    export const DataFrameRowFunc = '_VSCODE_getDataFrameRows';

    // Constants for the debugger which imports the script files
    export const DataFrameImport = `__import__('vscodeDataFrame')`;
    export const DataFrameInfoImportFunc = `${DataFrameImport}._VSCODE_getDataFrameInfo`;
    export const DataFrameRowImportFunc = `${DataFrameImport}._VSCODE_getDataFrameRows`;
}

export namespace GetVariableInfo {
    export function SysPath(rootDir: string) {
        return path.join(rootDir, 'pythonFiles', 'vscode_datascience_helpers', 'getVariableInfo');
    }

    export function GetVariableInfoSysImport(rootDir: string) {
        return `import sys\nsys.path.append("${SysPath(rootDir).replace(/\\/g, '\\\\')}")`;
    }

    export function ScriptPath(rootDir: string) {
        return path.join(SysPath(rootDir), 'vscodeGetVariableInfo.py');
    }

    export const VariableInfoFunc = '_VSCODE_getVariableInfo';
    export const VariablePropertiesFunc = '_VSCODE_getVariableProperties';
    export const VariableTypesFunc = '_VSCODE_getVariableTypes';

    // Constants for the debugger which imports the script files
    export const VariableInfoImportName = `__import__('vscodeGetVariableInfo')`;
    export const VariableInfoImportFunc = `${VariableInfoImportName}._VSCODE_getVariableInfo`;
}

export namespace AddRunCellHook {
    export function SysPath(rootDir: string) {
        return path.join(rootDir, 'pythonFiles', 'vscode_datascience_helpers', 'kernel');
    }
    export function ScriptPath(rootDir: string) {
        return path.join(SysPath(rootDir), 'addRunCellHook.py');
    }
}
