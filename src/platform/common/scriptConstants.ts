import { joinPath } from '../vscode-path/resources';
import { IExtensionContext } from './types';

export namespace DataFrameLoading {
    export function getScriptPath(context: IExtensionContext) {
        return joinPath(
            context.extensionUri,
            'pythonFiles',
            'vscode_datascience_helpers',
            'dataframes',
            'vscodeDataFrame.py'
        );
    }

    export const DataFrameInfoFunc = '_VSCODE_getDataFrameInfo';
    export const DataFrameRowFunc = '_VSCODE_getDataFrameRows';

    // Constants for the debugger which imports the script files
    export const DataFrameImport = `__import__('vscodeDataFrame')`;
    export const DataFrameInfoImportFunc = `${DataFrameImport}._VSCODE_getDataFrameInfo`;
    export const DataFrameRowImportFunc = `${DataFrameImport}._VSCODE_getDataFrameRows`;
}

export namespace GetVariableInfo {
    export function getScriptPath(context: IExtensionContext) {
        return joinPath(
            context.extensionUri,
            'pythonFiles',
            'vscode_datascience_helpers',
            'getVariableInfo',
            'vscodeGetVariableInfo.py'
        );
    }

    export const VariableInfoFunc = '_VSCODE_getVariableInfo';
    export const VariablePropertiesFunc = '_VSCODE_getVariableProperties';
    export const VariableTypesFunc = '_VSCODE_getVariableTypes';

    // Constants for the debugger which imports the script files
    export const VariableInfoImportName = `__import__('vscodeGetVariableInfo')`;
    export const VariableInfoImportFunc = `${VariableInfoImportName}._VSCODE_getVariableInfo`;
}

export namespace AddRunCellHook {
    export function getScriptPath(context: IExtensionContext) {
        return joinPath(
            context.extensionUri,
            'pythonFiles',
            'vscode_datascience_helpers',
            'kernel',
            'addRunCellHook.py'
        );
    }
}
