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
