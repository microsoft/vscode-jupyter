import { Disposable, QuickPickItem } from 'vscode';
import { Resource } from '../../common/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';

export const IInterpreterSelector = Symbol('IInterpreterSelector');
export interface IInterpreterSelector extends Disposable {
    getSuggestions(resource: Resource): Promise<IInterpreterQuickPickItem[]>;
}

export interface IInterpreterQuickPickItem extends QuickPickItem {
    path: string;
    /**
     * The interpreter related to this quickpick item.
     *
     * @type {PythonEnvironment}
     * @memberof IInterpreterQuickPickItem
     */
    interpreter: PythonEnvironment;
}
