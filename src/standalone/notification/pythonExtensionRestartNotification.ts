// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import * as localize from '../../platform/common/utils/localize';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { IKernelProvider } from '../../kernels/types';
import { window } from 'vscode';

// This class is responsible for watching if the Python Extension installation status changes, and if it does
// update the users if any notebooks are running and need to be restarted.
@injectable()
export class PythonExtensionRestartNotification implements IExtensionSyncActivationService {
    constructor(
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider
    ) {}
    activate(): void {
        this.extensionChecker.onPythonExtensionInstallationStatusChanged(
            this.onPythonExtensionInstallationStatusChanged,
            this,
            this.disposables
        );
    }

    // When the python extension is installed we need to notify if any active kernels might need to be
    // restarted to pick up changes
    private async onPythonExtensionInstallationStatusChanged(status: 'installed' | 'uninstalled') {
        if (status === 'installed' && this.anyKernelsAreActive()) {
            // Restart required notification message
            window
                .showInformationMessage(localize.DataScience.pythonExtensionInstalled, localize.Common.ok)
                .then(noop, noop);
        }
    }

    // Return true if any kernels are currently active
    private anyKernelsAreActive(): boolean {
        return this.kernelProvider.kernels.length > 0;
    }
}
