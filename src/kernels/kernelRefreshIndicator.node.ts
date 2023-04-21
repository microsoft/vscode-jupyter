// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { traceInfo } from '../platform/logging';

/**
 * Ensures we refresh the list of Python environments upon opening a Notebook.
 */
@injectable()
export class KernelRefreshIndicator implements IExtensionSyncActivationService {
    private refreshedOnceBefore: boolean = false;
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {
        disposables.push(this);
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public activate() {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            this.startRefreshWithPython();
        } else {
            this.startRefreshWithoutPython();
            this.extensionChecker.onPythonExtensionInstallationStatusChanged(
                () => {
                    if (this.extensionChecker.isPythonExtensionInstalled) {
                        this.startRefreshWithPython();
                    }
                },
                this,
                this.disposables
            );
        }
    }
    private startRefreshWithoutPython() {
        if (this.refreshedOnceBefore) {
            return;
        }
        this.refreshedOnceBefore = true;
    }
    private startRefreshWithPython() {
        if (this.refreshedOnceBefore) {
            return;
        }
        this.refreshedOnceBefore = true;
        const id = Date.now().toString();
        traceInfo(`Start refreshing Kernel Picker (${id})`);
    }
}
