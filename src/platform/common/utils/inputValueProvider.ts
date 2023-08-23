// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, QuickInputButtons, window } from 'vscode';
import { CancellationTokenSource, Disposable } from 'vscode-jsonrpc';
import { raceCancellationError } from '../cancellation';
import { disposeAllDisposables } from '../helpers';
import { Disposables } from '../utils';
import { createDeferred } from './async';

class BackError extends Error {}
export class WorkflowInputValueProvider extends Disposables {
    private readonly token = this._register(new CancellationTokenSource());
    public async getValue(options: {
        title: string;
        value?: string;
        ignoreFocusOut?: boolean;
        prompt?: string;
        validationMessage?: string;
        password?: boolean;
    }): Promise<{ value: string; navigation?: undefined } | { value?: undefined; navigation: 'cancel' | 'back' }> {
        console.error('Why was this called');
        const disposables: Disposable[] = [];
        try {
            const input = window.createInputBox();
            disposables.push(input);
            input.ignoreFocusOut = true;
            input.title = options.title;
            input.ignoreFocusOut = options.ignoreFocusOut === true;
            input.prompt = options.prompt || '';
            input.value = options.value || '';
            input.password = options.password === true;
            input.validationMessage = options.validationMessage || '';
            input.buttons = [QuickInputButtons.Back];
            input.show();
            const deferred = createDeferred<string>();
            disposables.push(input.onDidHide(() => deferred.reject(new CancellationError())));
            input.onDidTriggerButton(
                (e) => {
                    if (e === QuickInputButtons.Back) {
                        deferred.reject(new BackError());
                    }
                },
                this,
                disposables
            );
            input.onDidAccept(() => deferred.resolve(input.value.trim() || options.value), this, disposables);
            const value = await raceCancellationError(this.token.token, deferred.promise);
            return { value };
        } catch (ex) {
            if (ex instanceof BackError) {
                return { navigation: 'back' };
            }
            return { navigation: 'cancel' };
        } finally {
            disposeAllDisposables(disposables);
        }
    }
}
