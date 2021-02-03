// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { CancellationToken, EventEmitter } from 'vscode';
import { IPythonExtensionChecker } from '../../../api/types';
import { traceError, traceInfo } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IDisposableRegistry, IPathUtils, Resource } from '../../../common/types';
import { createDeferredFromPromise } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { IInterpreterSelector } from '../../../interpreter/configuration/types';
import { IInterpreterService } from '../../../interpreter/contracts';
import { IKernelFinder } from '../../kernel-launcher/types';
import { IJupyterSessionManager, IJupyterSessionManagerFactory } from '../../types';
import { isPythonKernelConnection } from './helpers';
import { KernelService } from './kernelService';
import { ActiveJupyterSessionKernelSelectionListProvider } from './providers/activeJupyterSessionKernelProvider';
import { InstalledLocalKernelSelectionListProvider } from './providers/installedLocalKernelProvider';
import { InstalledJupyterKernelSelectionListProvider } from './providers/installJupyterKernelProvider';
import { InterpreterKernelSelectionListProvider } from './providers/interpretersAsKernelProvider';
import {
    getKernelConnectionId,
    IKernelSpecQuickPickItem,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from './types';

const isSimplePythonDisplayName = /python\s?\d?\.?\d?/;

/**
 * Provides a list of kernel specs for selection, for both local and remote sessions.
 *
 * @export
 * @class KernelSelectionProviderFactory
 */
@injectable()
export class KernelSelectionProvider {
    private localSuggestionsCache: IKernelSpecQuickPickItem<
        KernelSpecConnectionMetadata | PythonKernelConnectionMetadata
    >[] = [];
    private remoteSuggestionsCache: IKernelSpecQuickPickItem<
        LiveKernelConnectionMetadata | KernelSpecConnectionMetadata
    >[] = [];
    private _listChanged = new EventEmitter<Resource>();
    /**
     * List of ids of kernels that should be hidden from the kernel picker.
     */
    private readonly kernelIdsToHide = new Set<string>();

    public get onDidChangeSelections() {
        return this._listChanged.event;
    }
    constructor(
        @inject(KernelService) private readonly kernelService: KernelService,
        @inject(IInterpreterSelector) private readonly interpreterSelector: IInterpreterSelector,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
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
    public async getKernelSelectionsForRemoteSession(
        resource: Resource,
        sessionManager: IJupyterSessionManager,
        cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<LiveKernelConnectionMetadata | KernelSpecConnectionMetadata>[]> {
        const getSelections = async () => {
            const installedKernelsPromise = new InstalledJupyterKernelSelectionListProvider(
                this.kernelService,
                this.pathUtils,
                this.extensionChecker,
                this.interpreterService,
                sessionManager
            ).getKernelSelections(resource, cancelToken);
            const liveKernelsPromise = new ActiveJupyterSessionKernelSelectionListProvider(
                sessionManager,
                this.pathUtils
            ).getKernelSelections(resource, cancelToken);
            const [installedKernels, liveKernels] = await Promise.all([installedKernelsPromise, liveKernelsPromise]);

            // Sort by name.
            installedKernels.sort((a, b) => (a.label === b.label ? 0 : a.label > b.label ? 1 : -1));
            liveKernels.sort((a, b) => (a.label === b.label ? 0 : a.label > b.label ? 1 : -1));
            return [...liveKernels!, ...installedKernels!];
        };

        const liveItems = getSelections().then((items) => (this.remoteSuggestionsCache = items));
        // If we have something in cache, return that, while fetching in the background.
        const cachedItems =
            this.remoteSuggestionsCache.length > 0 ? Promise.resolve(this.remoteSuggestionsCache) : liveItems;
        const selections = await Promise.race([cachedItems, liveItems]);
        return selections.filter((item) => !this.kernelIdsToHide.has(item.selection.kernelModel?.id || ''));
    }
    /**
     * Gets a selection of kernel specs for a local session.
     */
    public async getKernelSelectionsForLocalSession(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<KernelSpecConnectionMetadata | PythonKernelConnectionMetadata>[]> {
        const getSelections = async () => {
            const installedKernelsPromise = new InstalledLocalKernelSelectionListProvider(
                this.kernelFinder,
                this.pathUtils,
                this.kernelService
            ).getKernelSelections(resource, cancelToken);
            const interpretersPromise = this.extensionChecker.isPythonExtensionInstalled
                ? new InterpreterKernelSelectionListProvider(this.interpreterSelector).getKernelSelections(
                      resource,
                      cancelToken
                  )
                : Promise.resolve([]);

            // eslint-disable-next-line prefer-const
            let [installedKernels, interpreters] = await Promise.all([installedKernelsPromise, interpretersPromise]);

            interpreters = interpreters
                .filter((item) => {
                    // If the interpreter is registered as a kernel then don't inlcude it.
                    if (
                        installedKernels.find((installedKernel) => {
                            if (!isPythonKernelConnection(installedKernel.selection)) {
                                return false;
                            }

                            const kernelDisplayName =
                                installedKernel.selection.kernelSpec?.display_name ||
                                installedKernel.selection.kernelSpec?.name ||
                                '';
                            // Possible user has a kernel named `Python` or `Python 3`.
                            // & if we have such a kernel, we should not display the corresponding interpreter.
                            if (
                                kernelDisplayName !== item.selection.interpreter?.displayName &&
                                !isSimplePythonDisplayName.test(kernelDisplayName.toLowerCase())
                            ) {
                                return false;
                            }

                            // If the python kernel belongs to an existing interpreter with the same path,
                            // Or if the python kernel has the exact same path as the interpreter, then its a duplicate.
                            // Paths on windows can either contain \ or / Both work.
                            // Thus, C:\Python.exe is the same as C:/Python.exe
                            // In the kernelspec.json we could have paths in argv such as C:\\Python.exe or C:/Python.exe.
                            const interpreterPathToCheck = (item.selection.interpreter.path || '').replace(/\\/g, '/');
                            return (
                                this.fs.areLocalPathsSame(
                                    ((installedKernel.selection.kernelSpec?.argv || [])[0] || '').replace(/\\/g, '/'),
                                    interpreterPathToCheck
                                ) ||
                                this.fs.areLocalPathsSame(
                                    (
                                        installedKernel.selection.kernelSpec?.interpreterPath ||
                                        installedKernel.selection.kernelSpec?.metadata?.interpreter?.path ||
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
                })
                .map((item) => {
                    // We don't want descriptions.
                    return { ...item, description: '' };
                });

            const unifiedList = [...installedKernels!, ...interpreters];
            // Sort by name.
            unifiedList.sort((a, b) => (a.label === b.label ? 0 : a.label > b.label ? 1 : -1));

            // Remote duplicates.
            const duplicatesList = new Set<string>();
            return unifiedList.filter((item) => {
                const id = getKernelConnectionId(item.selection);
                if (duplicatesList.has(id)) {
                    return false;
                } else {
                    duplicatesList.add(id);
                    return true;
                }
            });
        };

        const liveItems = getSelections().then((items) => (this.localSuggestionsCache = items));
        // If we have something in cache, return that, while fetching in the background.
        const cachedItems =
            this.localSuggestionsCache.length > 0 ? Promise.resolve(this.localSuggestionsCache) : liveItems;

        const liveItemsDeferred = createDeferredFromPromise(liveItems);
        const cachedItemsDeferred = createDeferredFromPromise(cachedItems);
        Promise.race([cachedItems, liveItems])
            .then(async () => {
                // If the cached items completed first, then if later the live items completes we need to notify
                // others that this selection has changed (however check if the results are different).
                if (cachedItemsDeferred.completed && !liveItemsDeferred.completed) {
                    try {
                        const [liveItemsList, cachedItemsList] = await Promise.all([liveItems, cachedItems]);
                        // If the list of live items is different from the cached list, then notify a change.
                        if (
                            liveItemsList.length !== cachedItemsList.length &&
                            liveItemsList.length > 0 &&
                            JSON.stringify(liveItemsList) !== JSON.stringify(cachedItemsList)
                        ) {
                            traceInfo('Notify changes to list of local kernels');
                            this._listChanged.fire(resource);
                        }
                    } catch (ex) {
                        traceError('Error in fetching kernel selections', ex);
                    }
                }
            })
            .catch(noop);

        return Promise.race([cachedItems, liveItems]);
    }
}
