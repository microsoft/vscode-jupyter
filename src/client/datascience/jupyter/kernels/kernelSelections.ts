// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { cloneDeep } from 'lodash';
import * as path from 'path';
import { CancellationToken, EventEmitter } from 'vscode';
import { IPythonExtensionChecker } from '../../../api/types';
import { PYTHON_LANGUAGE } from '../../../common/constants';
import { traceError, traceInfo } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IPathUtils, Resource } from '../../../common/types';
import { createDeferredFromPromise } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { IInterpreterSelector } from '../../../interpreter/configuration/types';
import { IInterpreterService } from '../../../interpreter/contracts';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { IKernelFinder } from '../../kernel-launcher/types';
import { IJupyterKernelSpec, IJupyterSessionManager } from '../../types';
import { detectDefaultKernelName, isPythonKernelConnection } from './helpers';
import { KernelService } from './kernelService';
import {
    getKernelConnectionId,
    IKernelSelectionListProvider,
    IKernelSpecQuickPickItem,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata,
    LiveKernelModel,
    PythonKernelConnectionMetadata
} from './types';

// Small classes, hence all put into one file.
// tslint:disable: max-classes-per-file

const isSimplePythonDisplayName = /python\s?\d?\.?\d?/;
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
    // If we have a matching interpreter, then display that path in the dropdown else path of the kernelspec.
    const pathToKernel = kernelSpec.metadata?.interpreter?.path || kernelSpec.path;

    // Its possible we could have kernels with the same name.
    // Include the path of the interpreter that owns this kernel or path of kernelspec.json file in description.
    // If we only have name of executable like `dotnet` or `python`, then include path to kernel json.
    // Similarly if this is a python kernel and pathTokernel is just `python`, look for corresponding interpreter that owns this and include its path.

    // E.g.
    // If its a python kernel with python path in kernel spec we display:
    //  detail: ~/user friendly path to python interpreter
    // If its a non-python kernel and we have the fully qualified path to executable:
    //  detail: ~/user friendly path to executable
    // If its a non-python kernel and we only have name of executable like `java/dotnet` & we we have the fully qualified path to interpreter that owns this kernel:
    //  detail: ~/user friendly path to kenelspec.json file

    let detail = pathUtils.getDisplayName(pathToKernel);
    if (pathToKernel === path.basename(pathToKernel)) {
        const pathToInterpreterOrKernelSpec =
            kernelSpec.language?.toLowerCase() === PYTHON_LANGUAGE.toLocaleLowerCase()
                ? kernelSpec.interpreterPath
                : kernelSpec.specFile || '';
        if (pathToInterpreterOrKernelSpec) {
            detail = pathUtils.getDisplayName(pathToInterpreterOrKernelSpec);
        }
    }
    return {
        label: kernelSpec.display_name,
        detail,
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
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly interpreterService: IInterpreterService,
        private readonly sessionManager?: IJupyterSessionManager
    ) {}
    public async getKernelSelections(
        resource: Resource,
        cancelToken?: CancellationToken | undefined
    ): Promise<IKernelSpecQuickPickItem<KernelSpecConnectionMetadata>[]> {
        const activeInterpreter = this.interpreterService.getActiveInterpreter(resource);
        const items = await this.kernelService.getKernelSpecs(this.sessionManager, cancelToken);
        // Always clone, so we can make changes to this.
        const selections = items.map((item) => getQuickPickItemForKernelSpec(cloneDeep(item), this.pathUtils));

        // Default the interpreter to the local interpreter (if none is provided).
        if (this.extensionChecker.isPythonExtensionInstalled) {
            // This process is slow, hence the need to cache this result set.
            await Promise.all(
                selections.map(async (kernel) => {
                    // Find matching interpreter for Python kernels.
                    if (
                        !kernel.selection.interpreter &&
                        kernel.selection.kernelSpec &&
                        kernel.selection.kernelSpec?.language === PYTHON_LANGUAGE.toLocaleLowerCase()
                    ) {
                        kernel.selection.interpreter = await this.kernelService.findMatchingInterpreter(
                            kernel.selection.kernelSpec
                        );
                    }
                    kernel.selection.interpreter = kernel.selection.interpreter || (await activeInterpreter);
                })
            );
        } else {
            activeInterpreter.catch(noop);
        }
        sendTelemetryEvent(Telemetry.NumberOfRemoteKernelSpecs, { count: selections.length });
        return selections;
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
        const selections = items
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
        sendTelemetryEvent(Telemetry.NumberOfLocalKernelSpecs, { count: selections.length });
        return selections;
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
        @inject(IInterpreterSelector) private readonly interpreterService: IInterpreterService,
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
                        this.extensionChecker,
                        this.interpreterService,
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
                            return (
                                this.fs.areLocalPathsSame(
                                    (installedKernel.selection.kernelSpec?.argv || [])[0],
                                    item.selection.interpreter?.path || ''
                                ) ||
                                this.fs.areLocalPathsSame(
                                    installedKernel.selection.kernelSpec?.interpreterPath ||
                                        installedKernel.selection.kernelSpec?.metadata?.interpreter?.path ||
                                        '',
                                    item.selection.interpreter?.path || ''
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
