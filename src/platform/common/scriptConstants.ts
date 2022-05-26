import * as path from '../vscode-path/path';

export * from './constants';

export namespace DataFrameLoading {
    export const SysPath = path.join('pythonFiles', 'vscode_datascience_helpers', 'dataframes');
    export const ScriptPath = path.join(SysPath, 'vscodeDataFrame.py');

    export const DataFrameInfoFunc = '_VSCODE_getDataFrameInfo';
    export const DataFrameRowFunc = '_VSCODE_getDataFrameRows';

    // Constants for the debugger which imports the script files
    export const DataFrameImport = `__import__('vscodeDataFrame')`;
    export const DataFrameInfoImportFunc = `${DataFrameImport}._VSCODE_getDataFrameInfo`;
    export const DataFrameRowImportFunc = `${DataFrameImport}._VSCODE_getDataFrameRows`;
}

export namespace GetVariableInfo {
    export const SysPath = path.join('pythonFiles', 'vscode_datascience_helpers', 'getVariableInfo');
    export const ScriptPath = path.join(SysPath, 'vscodeGetVariableInfo.py');
    export const VariableInfoFunc = '_VSCODE_getVariableInfo';
    export const VariablePropertiesFunc = '_VSCODE_getVariableProperties';
    export const VariableTypesFunc = '_VSCODE_getVariableTypes';

    // Constants for the debugger which imports the script files
    export const VariableInfoImportName = `__import__('vscodeGetVariableInfo')`;
    export const VariableInfoImportFunc = `${VariableInfoImportName}._VSCODE_getVariableInfo`;
}

export namespace AddRunCellHook {
    export const SysPath = path.join('pythonFiles', 'vscode_datascience_helpers', 'kernel');
    export const ScriptPath = path.join(SysPath, 'addRunCellHook.py');
}
