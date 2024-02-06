// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { noop } from '../../../platform/common/utils/misc';
import { extensions } from 'vscode';

/**
 * 3rd party extensions contribute kernels. We need to activate them so that they can register their kernel providers.
 * If VS Code requests kernels from Jupyter extension, then at that point we will activate the 3rd party extensions.
 * Else eagerly activating them as soon as Jupyter loads, will unnecessarily activate them and slow overall startup.
 */
@injectable()
export class EagerlyActivateJupyterUriProviders implements IExtensionSyncActivationService {
    public activate(): void {
        this.eagerlyActivateOtherExtensions().catch(noop);
        // This is the right way, load extensions only when they are required.
        // this.disposables.push(
        //     notebooks.registerKernelSourceActionProvider(JupyterNotebookView, {
        //         provideNotebookKernelSourceActions: () => {
        //             this.eagerlyActivateOtherExtensions().catch(noop);
        //             return [];
        //         }
        //     })
        // );
        // this.disposables.push(
        //     notebooks.registerKernelSourceActionProvider(InteractiveWindowView, {
        //         provideNotebookKernelSourceActions: () => {
        //             this.eagerlyActivateOtherExtensions().catch(noop);
        //             return [];
        //         }
        //     })
        // );
    }

    private async eagerlyActivateOtherExtensions(): Promise<void> {
        await Promise.all(
            extensions.all
                .filter((e) => e.packageJSON?.contributes?.pythonRemoteServerProvider)
                .map((e) => (e.isActive ? Promise.resolve() : e.activate().then(noop, noop)))
        );
    }
}
