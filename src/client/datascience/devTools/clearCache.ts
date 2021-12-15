import { commands } from 'vscode';
import { IExtensionContext } from '../../common/types';

export function addClearCacheCommand(context: IExtensionContext, isDevMode: boolean) {
    if (!isDevMode) {
        return;
    }
    commands.registerCommand('dataScience.ClearCache', () => {
        // eslint-disable-next-line no-restricted-syntax
        for (const key of context.globalState.keys()) {
            void context.globalState.update(key, undefined);
        }
        // eslint-disable-next-line no-restricted-syntax
        for (const key of context.workspaceState.keys()) {
            void context.workspaceState.update(key, undefined);
        }
    });
}
