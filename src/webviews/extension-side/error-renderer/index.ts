// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject } from 'inversify';
import * as vscode from 'vscode';
import { ErrorRendererMessageType, Localizations } from '../../../messageTypes';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { WebViews } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';

/**
 * Responsible for sending loc data to renderers
 */
// @injectable()
export class ExtensionSideRenderer implements IDisposable, IExtensionSyncActivationService {
    private disposables: IDisposable[] = [];
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        disposables.push(this);
    }
    activate(): void {
        const errorRendererMessage = vscode.notebooks.createRendererMessaging('jupyter-error-renderer');
        const loadLocMessage = {
            type: ErrorRendererMessageType.ResponseLoadLoc,
            payload: {
                errorOutputExceedsLinkToOpenFormatString: WebViews.errorOutputExceedsLinkToOpenFormatString
            } as Localizations
        };
        errorRendererMessage.postMessage(loadLocMessage).then(noop, noop);
        errorRendererMessage.onDidReceiveMessage(
            (e) => {
                if (e.message.type === ErrorRendererMessageType.RequestLoadLoc) {
                    errorRendererMessage.postMessage(loadLocMessage).then(noop, noop);
                }
            },
            this,
            this.disposables
        );
    }
    dispose(): void {
        disposeAllDisposables(this.disposables);
    }
}
