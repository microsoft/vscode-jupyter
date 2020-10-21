// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { CancellationToken, EventEmitter } from 'vscode';
import { IPythonExtensionChecker } from '../../../api/types';
import { traceError } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IPathUtils, Resource } from '../../../common/types';
import { createDeferredFromPromise } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { IInterpreterSelector } from '../../../interpreter/configuration/types';
import { IKernelFinder } from '../../kernel-launcher/types';
import { IJupyterKernelSpec, IJupyterSessionManager } from '../../types';
import { detectDefaultKernelName } from './helpers';
import { KernelService } from './kernelService';
import {
    IKernelSelectionListProvider,
    IKernelSpecQuickPickItem,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata,
    LiveKernelModel,
    PythonKernelConnectionMetadata
} from './types';

// Small classes, hence all put into one file.
// tslint:disable: max-classes-per-file

/**
 * Given a kernel spec, this will return a quick pick item with appropriate display names and the like.
 *
 * @param {IJupyterKernelSpec} kernelSpec
 * @param {IPathUtils} pathUtils
 * @returns {IKernelSpecQuickPickItem}
 */
function getQuickPickItemForKernelSpec(
    kernelSpec: IJupyterKernelSpec,
    pathUtils: IPathUtils
): IKernelSpecQuickPickItem<KernelSpecConnectionMetadata> {
    return {
        label: kernelSpec.display_name,
        // If we have a matching interpreter, then display that path in the dropdown else path of the kernelspec.
        detail: pathUtils.getDisplayName(kernelSpec.metadata?.interpreter?.path || kernelSpec.path),
        selection: {
            kernelModel: undefined,
            kernelSpec: kernelSpec,
            interpreter: undefined,
            kind: 'startUsingKernelSpec'
        }
    };
}

/**
 * Given an active kernel, this will return a quick pick item with appropriate display names and the like.
 *
 * @param {(LiveKernelModel)} kernel
 * @param {IPathUtils} pathUtils
 * @returns {IKernelSpecQuickPickItem}
 */
function getQuickPickItemForActiveKernel(
    kernel: LiveKernelModel,
    pathUtils: IPathUtils
): IKernelSpecQuickPickItem<LiveKernelConnectionMetadata> {
    const pickPath = kernel.metadata?.interpreter?.path || kernel.path;
    return {
        label: kernel.display_name || kernel.name || '',
        // If we have a session, use that path
        detail: kernel.session.path || !pickPath ? kernel.session.path : pathUtils.getDisplayName(pickPath),
        description: localize.DataScience.jupyterSelectURIRunningDetailFormat().format(
            kernel.lastActivityTime.toLocaleString(),
            kernel.numberOfConnections.toString()
        ),
        selection: { kernelModel: kernel, interpreter: undefined, kind: 'connectToLiveKernel' }
    };
}

/**
 * Provider for active kernel specs in a jupyter session.
 *
 * @export
 * @class ActiveJupyterSessionKernelSelectionListProvider
 * @implements {IKernelSelectionListProvider}
 */
export class ActiveJupyterSessionKernelSelectionListProvider
    implements IKernelSelectionListProvider<LiveKernelConnectionMetadata> {
    constructor(private readonly sessionManager: IJupyterSessionManager, private readonly pathUtils: IPathUtils) {}
    public async getKernelSelections(
        _resource: Resource,
        _cancelToken?: CancellationToken | undefined
    ): Promise<IKernelSpecQuickPickItem<LiveKernelConnectionMetadata>[]> {
        const [activeKernels, activeSessions, kernelSpecs] = await Promise.all([
            this.sessionManager.getRunningKernels(),
            this.sessionManager.getRunningSessions(),
            this.sessionManager.getKernelSpecs()
        ]);
        const items = activeSessions.map((item) => {
            const matchingSpec: Partial<IJupyterKernelSpec> =
                kernelSpecs.find((spec) => spec.name === item.kernel.name) || {};
            const activeKernel = activeKernels.find((active) => active.id === item.kernel.id) || {};
            // tslint:disable-next-line: no-object-literal-type-assertion
            return {
                ...item.kernel,
                ...matchingSpec,
                ...activeKernel,
                session: item
            } as LiveKernelModel;
        });
        return items
            .filter((item) => item.display_name || item.name)
            .filter((item) => 'lastActivityTime' in item && 'numberOfConnections' in item)
            .map((item) => getQuickPickItemForActiveKernel(item, this.pathUtils));
    }
}

/**
 * Provider for installed kernel specs (`python -m jupyter kernelspec list`).
 *
 * @export
 * @class InstalledJupyterKernelSelectionListProvider
 * @implements {IKernelSelectionListProvider}
 */
export class InstalledJupyterKernelSelectionListProvider
    implements IKernelSelectionListProvider<KernelSpecConnectionMetadata> {
    constructor(
        private readonly kernelService: KernelService,
        private readonly pathUtils: IPathUtils,
        private readonly sessionManager?: IJupyterSessionManager
    ) {}
    public async getKernelSelections(
        _resource: Resource,
        cancelToken?: CancellationToken | undefined
    ): Promise<IKernelSpecQuickPickItem<KernelSpecConnectionMetadata>[]> {
        const items = await this.kernelService.getKernelSpecs(this.sessionManager, cancelToken);
        return items.map((item) => getQuickPickItemForKernelSpec(item, this.pathUtils));
    }
}

// Provider for searching for installed kernelspecs on disk without using jupyter to search
export class InstalledRawKernelSelectionListProvider
    implements IKernelSelectionListProvider<KernelSpecConnectionMetadata> {
    constructor(private readonly kernelFinder: IKernelFinder, private readonly pathUtils: IPathUtils) {}
    public async getKernelSelections(
        resource: Resource,
        _cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<KernelSpecConnectionMetadata>[]> {
        const items = await this.kernelFinder.listKernelSpecs(resource);
        return items
            .filter((item) => {
                // If we have a default kernel name and a non-absolute path just hide the item
                // Otherwise we end up showing a bunch of "Python 3 - python" default items for
                // other interpreters
                const match = detectDefaultKernelName(item.name);
                if (match) {
                    return path.isAbsolute(item.path);
                }
                return true;
            })
            .map((item) => getQuickPickItemForKernelSpec(item, this.pathUtils));
    }
}

/**
 * Provider for interpreters to be treated as kernel specs.
 * I.e. return interpreters that are to be treated as kernel specs, and not yet installed as kernels.
 *
 * @export
 * @class InterpreterKernelSelectionListProvider
 * @implements {IKernelSelectionListProvider}
 */
export class InterpreterKernelSelectionListProvider
    implements IKernelSelectionListProvider<PythonKernelConnectionMetadata> {
    constructor(private readonly interpreterSelector: IInterpreterSelector) {}
    public async getKernelSelections(
        resource: Resource,
        _cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<PythonKernelConnectionMetadata>[]> {
        const items = await this.interpreterSelector.getSuggestions(resource);
        return items
            ? items.map((item) => {
                  return {
                      ...item,
                      // We don't want descriptions.
                      description: '',
                      selection: {
                          kernelModel: undefined,
                          interpreter: item.interpreter,
                          kernelSpec: undefined,
                          kind: 'startUsingPythonInterpreter'
                      }
                  };
              })
            : [];
    }
}

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
    public get onDidChangeSelections() {
        return this._listChanged.event;
    }
    constructor(
        @inject(KernelService) private readonly kernelService: KernelService,
        @inject(IInterpreterSelector) private readonly interpreterSelector: IInterpreterSelector,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {}
    /**
     * Gets a selection of kernel specs from a remote session.
     *
     * @param {Resource} resource
     * @param {IJupyterSessionManager} sessionManager
     * @param {CancellationToken} [cancelToken]
     * @returns {Promise<IKernelSpecQuickPickItem[]>}
     * @memberof KernelSelectionProvider
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
        return Promise.race([cachedItems, liveItems]);
    }
    /**
     * Gets a selection of kernel specs for a local session.
     *
     * @param {Resource} resource
     * @param type
     * @param {IJupyterSessionManager} [sessionManager]
     * @param {CancellationToken} [cancelToken]
     * @returns {Promise<IKernelSelectionListProvider>}
     * @memberof KernelSelectionProvider
     */
    public async getKernelSelectionsForLocalSession(
        resource: Resource,
        type: 'raw' | 'jupyter' | 'noConnection',
        sessionManager?: IJupyterSessionManager,
        cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<KernelSpecConnectionMetadata | PythonKernelConnectionMetadata>[]> {
        const getSelections = async () => {
            // For raw versus jupyter connections we need to use a different method for fetching installed kernelspecs
            // There is a possible unknown case for if we have a guest jupyter notebook that has not yet connected
            // in that case we don't use either method
            let installedKernelsPromise: Promise<
                IKernelSpecQuickPickItem<KernelSpecConnectionMetadata>[]
            > = Promise.resolve([]);
            switch (type) {
                case 'raw':
                    installedKernelsPromise = new InstalledRawKernelSelectionListProvider(
                        this.kernelFinder,
                        this.pathUtils
                    ).getKernelSelections(resource, cancelToken);
                    break;
                case 'jupyter':
                    installedKernelsPromise = new InstalledJupyterKernelSelectionListProvider(
                        this.kernelService,
                        this.pathUtils,
                        sessionManager
                    ).getKernelSelections(resource, cancelToken);
                    break;
                default:
                    break;
            }
            const interpretersPromise = this.extensionChecker.isPythonExtensionInstalled
                ? new InterpreterKernelSelectionListProvider(this.interpreterSelector).getKernelSelections(
                      resource,
                      cancelToken
                  )
                : Promise.resolve([]);

            // tslint:disable-next-line: prefer-const
            let [installedKernels, interpreters] = await Promise.all([installedKernelsPromise, interpretersPromise]);

            interpreters = interpreters
                .filter((item) => {
                    // If the interpreter is registered as a kernel then don't inlcude it.
                    if (
                        installedKernels.find(
                            (installedKernel) =>
                                installedKernel.selection.kernelSpec?.display_name ===
                                    item.selection.interpreter?.displayName &&
                                (this.fs.areLocalPathsSame(
                                    (installedKernel.selection.kernelSpec?.argv || [])[0],
                                    item.selection.interpreter?.path || ''
                                ) ||
                                    this.fs.areLocalPathsSame(
                                        installedKernel.selection.kernelSpec?.metadata?.interpreter?.path || '',
                                        item.selection.interpreter?.path || ''
                                    ))
                        )
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

            return unifiedList;
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
