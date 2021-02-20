// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../../../api/types';
import { IFileSystem } from '../../../common/platform/types';
import { IDisposableRegistry, Resource } from '../../../common/types';
import { IInterpreterSelector } from '../../../interpreter/configuration/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../../kernel-launcher/types';
import { IJupyterConnection, IJupyterSessionManagerFactory, INotebookProviderConnection } from '../../types';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { IKernelSpecQuickPickItem, KernelConnectionMetadata, PythonKernelConnectionMetadata } from './types';

const isSimplePythonDisplayName = /python\s?\d?\.?\d?/;

/**
 * Provides a list of kernel specs for selection, for both local and remote sessions.
 *
 * @export
 * @class KernelSelectionProviderFactory
 */
@injectable()
export class KernelSelectionProvider {
    private suggestionsCache: IKernelSpecQuickPickItem<KernelConnectionMetadata>[] = [];
    /**
     * List of ids of kernels that should be hidden from the kernel picker.
     */
    private readonly kernelIdsToHide = new Set<string>();
    constructor(
        @inject(IInterpreterSelector) private readonly interpreterSelector: IInterpreterSelector,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IJupyterSessionManagerFactory) private jupyterSessionManagerFactory: IJupyterSessionManagerFactory
    ) {
        disposableRegistry.push(
            this.jupyterSessionManagerFactory.onRestartSessionCreated(this.addKernelToIgnoreList.bind(this))
        );
        disposableRegistry.push(
            this.jupyterSessionManagerFactory.onRestartSessionUsed(this.removeKernelFromIgnoreList.bind(this))
        );
    }

    /**
     * Ensure kernels such as those associated with the restart session are not displayed in the kernel picker.
     */
    public addKernelToIgnoreList(kernel: Kernel.IKernelConnection): void {
        this.kernelIdsToHide.add(kernel.id);
        this.kernelIdsToHide.add(kernel.clientId);
    }
    /**
     * Opposite of the add counterpart.
     */
    public removeKernelFromIgnoreList(kernel: Kernel.IKernelConnection): void {
        this.kernelIdsToHide.delete(kernel.id);
        this.kernelIdsToHide.delete(kernel.clientId);
    }

    /**
     * Gets a selection of kernel specs from a remote session.
     */
    public async getKernelSelections(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<KernelConnectionMetadata>[]> {
        const getSelections = this.getNonCachedSelections(resource, connInfo, cancelToken);

        const liveItems = getSelections.then((items) => (this.suggestionsCache = items));
        // If we have something in cache, return that, while fetching in the background.
        const cachedItems = this.suggestionsCache.length > 0 ? Promise.resolve(this.suggestionsCache) : liveItems;
        return Promise.race([cachedItems, liveItems]);
    }

    private async getNonCachedSelections(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        _cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<KernelConnectionMetadata>[]> {
        // Use either the local or remote kernel finder
        if (!connInfo || connInfo.localLaunch) {
            // For local we want interpreter suggestions too
            let [kernels, interpreters] = await Promise.all([
                this.localKernelFinder.listKernels(resource),
                this.getInterpreterKernels(resource)
            ]);

            interpreters = interpreters.filter((item) => {
                // If the interpreter is registered as a kernel then don't inlcude it.
                if (
                    kernels.find((installedKernel) => {
                        if (installedKernel.kind !== 'startUsingPythonInterpreter') {
                            return false;
                        }

                        const kernelDisplayName =
                            installedKernel.kernelSpec?.display_name || installedKernel.kernelSpec?.name || '';
                        // Possible user has a kernel named `Python` or `Python 3`.
                        // & if we have such a kernel, we should not display the corresponding interpreter.
                        if (
                            kernelDisplayName !== item.interpreter?.displayName &&
                            !isSimplePythonDisplayName.test(kernelDisplayName.toLowerCase())
                        ) {
                            return false;
                        }

                        // If the python kernel belongs to an existing interpreter with the same path,
                        // Or if the python kernel has the exact same path as the interpreter, then its a duplicate.
                        // Paths on windows can either contain \ or / Both work.
                        // Thus, C:\Python.exe is the same as C:/Python.exe
                        // In the kernelspec.json we could have paths in argv such as C:\\Python.exe or C:/Python.exe.
                        const interpreterPathToCheck = (item.interpreter?.path || '').replace(/\\/g, '/');
                        return (
                            this.fs.areLocalPathsSame(
                                ((installedKernel.kernelSpec?.argv || [])[0] || '').replace(/\\/g, '/'),
                                interpreterPathToCheck
                            ) ||
                            this.fs.areLocalPathsSame(
                                (
                                    installedKernel.kernelSpec?.interpreterPath ||
                                    installedKernel.kernelSpec?.metadata?.interpreter?.path ||
                                    ''
                                ).replace(/\\/g, '/'),
                                interpreterPathToCheck
                            )
                        );
                    })
                ) {
                    return false;
                }
                return true;
            });

            // Convert to a quick pick list.
            return [...kernels, ...interpreters].map(this.mapKernelToSelection);
        } else {
            // Remote is a little simpler
            const kernels = await this.remoteKernelFinder.listKernels(resource, connInfo);

            // Filter out excluded ids
            const filtered = kernels.filter(
                (k) => k.kind !== 'connectToLiveKernel' || !this.kernelIdsToHide.has(k.kernelModel.id || '')
            );

            // Convert to a quick pick list.
            return filtered.map(this.mapKernelToSelection);
        }
    }

    private mapKernelToSelection(kernel: KernelConnectionMetadata): IKernelSpecQuickPickItem<KernelConnectionMetadata> {
        const displayName = getDisplayNameOrNameOfKernelConnection(kernel);
        return {
            label: displayName,
            ...kernel,
            // We don't want descriptions.
            description: '',
            selection: kernel
        };
    }

    private async getInterpreterKernels(resource: Resource): Promise<KernelConnectionMetadata[]> {
        const interpreterSuggestions = this.extensionChecker.isPythonExtensionInstalled
            ? await this.interpreterSelector.getSuggestions(resource)
            : [];
        return interpreterSuggestions.map((i) => {
            const result: PythonKernelConnectionMetadata = {
                kind: 'startUsingPythonInterpreter',
                interpreter: i.interpreter,
                kernelSpec: undefined
            };
            return result;
        });
    }
}
