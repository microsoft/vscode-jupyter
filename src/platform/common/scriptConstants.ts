import { joinPath } from '../vscode-path/resources';
import { IExtensionContext } from './types';

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
