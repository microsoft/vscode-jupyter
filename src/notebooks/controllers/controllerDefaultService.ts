// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { isPythonNotebook } from '../../kernels/helpers';
import { PreferredRemoteKernelIdProvider } from '../../kernels/jupyter/preferredRemoteKernelIdProvider';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { IDisposableRegistry, IFeaturesManager, IsWebExtension, Resource } from '../../platform/common/types';
import { getNotebookMetadata } from '../../platform/common/utils';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { traceInfoIfCI, traceVerbose, traceDecoratorVerbose, traceError } from '../../platform/logging';
import { isEqual } from '../../platform/vscode-path/resources';
import { createActiveInterpreterController } from './helpers';
import { IControllerDefaultService, IControllerRegistration, IVSCodeNotebookController } from './types';

/**
 * Determines the 'default' kernel for a notebook. Default is what kernel should be used if there's no metadata in a notebook.
 */
@injectable()
export class ControllerDefaultService implements IControllerDefaultService {
    private get isLocalLaunch(): boolean {
        return this.serverUriStorage.isLocalLaunch;
    }
    constructor(
        @inject(IControllerRegistration) private readonly registration: IControllerRegistration,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) readonly disposables: IDisposableRegistry,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteFinder: PreferredRemoteKernelIdProvider,
        @inject(IsWebExtension) private readonly isWeb: boolean,
        @inject(IFeaturesManager) private readonly featureManager: IFeaturesManager
    ) {}
    public async computeDefaultController(
        resource: Resource,
        viewType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): Promise<IVSCodeNotebookController | undefined> {
        if (this.isLocalLaunch) {
            traceInfoIfCI('CreateActiveInterpreterController');
            return createActiveInterpreterController(viewType, resource, this.interpreters, this.registration);
        } else {
            traceInfoIfCI('CreateDefaultRemoteController');
            const notebook =
                viewType === JupyterNotebookView
                    ? this.notebook.notebookDocuments.find((item) => isEqual(item.uri, resource, true))
                    : undefined;
            const controller = await this.createDefaultRemoteController(viewType, notebook);
            // If we're running on web, there is no active interpreter to fall back to
            if (controller || this.isWeb) {
                return controller;
            }
            traceVerbose('No default remote controller, hence returning the active interpreter');
            return createActiveInterpreterController(viewType, resource, this.interpreters, this.registration);
        }
    }

    public async getActiveInterpreterController(
        resource: Resource,
        viewType: 'jupyter-notebook' | 'interactive'
    ): Promise<IVSCodeNotebookController | undefined> {
        return createActiveInterpreterController(viewType, resource, this.interpreters, this.registration);
    }

    @traceDecoratorVerbose('Get default Remote Controller')
    private async createDefaultRemoteController(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        notebook?: NotebookDocument
    ) {
        const metadata = notebook ? getNotebookMetadata(notebook) : undefined;
        const language =
            !metadata || isPythonNotebook(metadata) || !metadata.language_info?.name
                ? PYTHON_LANGUAGE
                : metadata.language_info.name;
        const kernelName = metadata ? metadata.kernelspec?.name : undefined;
        if (this.featureManager.features.kernelPickerType === 'Stable') {
            // Get all remote kernels
            await this.registration.loaded;
        }
        const preferredRemoteKernelId =
            notebook && this.preferredRemoteFinder
                ? await this.preferredRemoteFinder.getPreferredRemoteKernelId(notebook.uri)
                : undefined;

        if (preferredRemoteKernelId) {
            const liveKernelMatch = this.registration.registered.find(
                (item) =>
                    item.connection.kind === 'connectToLiveRemoteKernel' &&
                    preferredRemoteKernelId &&
                    item.connection.kernelModel.id === preferredRemoteKernelId
            );

            if (liveKernelMatch) {
                return liveKernelMatch;
            }
        }

        const controllers = this.registration.registered.filter((item) => {
            // Sort out interactive or non-interactive controllers
            if (
                item.connection.kind !== 'startUsingRemoteKernelSpec' ||
                item.controller.notebookType !== notebookType
            ) {
                return false;
            }
            return true;
        });
        if (controllers.length === 0) {
            traceError('No remote controllers');
            return;
        }

        // Find the default kernel `python` if we can find one
        // If not available, then return anything thats a python kernel
        let defaultPython3Kernel: IVSCodeNotebookController | undefined;
        let defaultPythonKernel: IVSCodeNotebookController | undefined;
        let defaultPythonLanguageKernel: IVSCodeNotebookController | undefined;
        controllers.forEach((item) => {
            // Sort out interactive or non-interactive controllers
            if (item.connection.kind !== 'startUsingRemoteKernelSpec') {
                return;
            }
            if (item.connection.kernelSpec.name === 'python') {
                defaultPythonKernel = item;
            } else if (item.connection.kernelSpec.name === 'python3') {
                defaultPython3Kernel = item;
            } else if (item.connection.kernelSpec.language === PYTHON_LANGUAGE) {
                defaultPythonLanguageKernel = item;
            }
        });

        const defaultController = defaultPython3Kernel || defaultPythonKernel || defaultPythonLanguageKernel;

        if (language === PYTHON_LANGUAGE) {
            return defaultController;
        } else {
            let matchingKernelNameController: IVSCodeNotebookController | undefined;
            let matchingKernelLanguageController: IVSCodeNotebookController | undefined;
            controllers.forEach((item) => {
                // Sort out interactive or non-interactive controllers
                if (item.connection.kind !== 'startUsingRemoteKernelSpec') {
                    return;
                }
                if (item.connection.kernelSpec.name === kernelName) {
                    matchingKernelNameController = item;
                } else if (item.connection.kernelSpec.language === language) {
                    matchingKernelLanguageController = item;
                }
            });

            return matchingKernelNameController || matchingKernelLanguageController || defaultController;
        }
    }
}
