// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IBaseKernel,
    IKernel,
    KernelConnectionMetadata,
    IKernelProvider,
    isLocalConnection,
    KernelInterpreterDependencyResponse,
    KernelAction,
    KernelActionSource,
    IThirdPartyKernelProvider,
    IKernelController
} from '../../kernels/types';
import { CancellationError, Memento, NotebookDocument, Uri, commands, window } from 'vscode';
import { logger } from '../../platform/logging';
import { Resource, IMemento, GLOBAL_MEMENTO, IDisplayOptions, IDisposable } from '../../platform/common/types';
import { createDeferred, createDeferredFromPromise, Deferred } from '../../platform/common/utils/async';
import { DataScience } from '../../platform/common/utils/localize';
import { sendKernelTelemetryEvent } from '../../kernels/telemetry/sendKernelTelemetryEvent';
import { IServiceContainer } from '../../platform/ioc/types';
import { Commands } from '../../platform/common/constants';
import { Telemetry } from '../../telemetry';
import { clearInstalledIntoInterpreterMemento } from '../../platform/interpreter/installer/productInstaller';
import { Product } from '../../platform/interpreter/installer/types';
import { INotebookEditorProvider } from '../types';
import { selectKernel } from './kernelSelector';
import { KernelDeadError } from '../../kernels/errors/kernelDeadError';
import { IDataScienceErrorHandler } from '../../kernels/errors/types';
import { noop } from '../../platform/common/utils/misc';
import { IRawNotebookSupportedService } from '../../kernels/raw/types';
import { IControllerRegistration, IVSCodeNotebookController } from './types';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { isCancellationError } from '../../platform/common/cancellation';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { ITrustedKernelPaths } from '../../kernels/raw/finder/types';
import { KernelSpecNotTrustedError } from '../../kernels/errors/kernelSpecNotTrustedError';
import { isKernelDead } from '../../kernels/kernel';

/**
 * Class used for connecting a controller to an instance of an IKernel
 */
export class KernelConnector {
    private static async switchController(
        resource: Resource,
        serviceContainer: IServiceContainer
    ): Promise<{ controller: IKernelController; metadata: KernelConnectionMetadata } | undefined> {
        const notebookEditorProvider = serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        const editor = notebookEditorProvider.findNotebookEditor(resource);

        // Listen for selection change events (may not fire if user cancels)
        const controllerManager = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        let controller: IVSCodeNotebookController | undefined;
        const waitForSelection = createDeferred<IVSCodeNotebookController>();
        const disposable = controllerManager.onControllerSelected((e) => waitForSelection.resolve(e.controller));

        const selected = await selectKernel(resource, serviceContainer.get(INotebookEditorProvider));
        if (selected && editor) {
            controller = await waitForSelection.promise;
        }
        disposable.dispose();
        return controller ? { controller: controller.controller, metadata: controller.connection } : undefined;
    }

    private static async notifyAndRestartDeadKernel(kernel: IBaseKernel): Promise<boolean> {
        const selection = await window.showErrorMessage(
            DataScience.cannotRunCellKernelIsDead(
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
            ),
            { modal: true },
            DataScience.showJupyterLogs,
            DataScience.restartKernel
        );
        let restartedKernel = false;
        switch (selection) {
            case DataScience.restartKernel: {
                await kernel.restart();
                restartedKernel = true;
                break;
            }
            case DataScience.showJupyterLogs: {
                commands.executeCommand(Commands.ViewJupyterOutput).then(noop, noop);
            }
        }
        return restartedKernel;
    }

    private static async handleKernelError(
        serviceContainer: IServiceContainer,
        error: Error,
        errorContext: KernelAction,
        resource: Resource,
        kernel: IBaseKernel,
        controller: IKernelController | undefined,
        metadata: KernelConnectionMetadata,
        actionSource: KernelActionSource
    ) {
        const memento = serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
        // Error handler may not be available in web situation
        const errorHandler = serviceContainer.get<IDataScienceErrorHandler>(IDataScienceErrorHandler);

        if (metadata.interpreter && errorContext === 'start') {
            // If we failed to start the kernel, then clear cache used to track
            // whether we have dependencies installed or not.
            // Possible something is missing.
            clearInstalledIntoInterpreterMemento(memento, Product.ipykernel, metadata.interpreter.uri).catch(noop);
        }

        const handleResult = await errorHandler.handleKernelError(
            error,
            errorContext,
            metadata,
            resource,
            actionSource
        );

        // Send telemetry for handling the error (if raw)
        const isLocal = isLocalConnection(metadata);

        // Raw notebook provider is not available in web
        const rawNotebookProvider = serviceContainer.tryGet<IRawNotebookSupportedService>(IRawNotebookSupportedService);
        const rawLocalKernel = rawNotebookProvider?.isSupported && isLocal;
        if (rawLocalKernel && errorContext === 'start') {
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartNoIpykernel, {
                reason: handleResult
            });
        }

        // Dispose the kernel no matter what happened as we need to go around again when there's an error
        kernel.dispose().catch(noop);

        switch (handleResult) {
            case KernelInterpreterDependencyResponse.cancel:
            case KernelInterpreterDependencyResponse.failed:
                throw error;

            case KernelInterpreterDependencyResponse.selectDifferentKernel: {
                // Loop around and create the new one. The user wants to switch

                // Update to the selected controller
                const result = await KernelConnector.switchController(resource, serviceContainer);
                if (!result) {
                    throw error;
                }
                controller = result.controller;
                metadata = result.metadata;
                break;
            }
        }

        return { controller, metadata };
    }

    private static convertContextToFunction(currentContext: KernelAction, options?: IDisplayOptions) {
        switch (currentContext) {
            case 'start':
            case 'execution':
                return (k: IBaseKernel) => k.start(options);

            case 'interrupt':
                return (k: IBaseKernel) => k.interrupt();

            case 'restart':
                return (k: IBaseKernel) => k.restart();
        }
    }

    private static connectionsByNotebook = new WeakMap<
        NotebookDocument,
        {
            kernel: Deferred<{
                kernel: IKernel;
                deadKernelAction?:
                    | 'deadKernelNeedsToBeRestarted'
                    | 'deadKernelWasNoRestarted'
                    | 'deadKernelWasRestarted';
            }>;
            options: IDisplayOptions;
        }
    >();
    private static connectionsByUri = new Map<
        string,
        {
            kernel: Deferred<{
                kernel: IBaseKernel;
                deadKernelAction?:
                    | 'deadKernelNeedsToBeRestarted'
                    | 'deadKernelWasNoRestarted'
                    | 'deadKernelWasRestarted';
            }>;
            options: IDisplayOptions;
        }
    >();

    private static async verifyKernelState(
        serviceContainer: IServiceContainer,
        notebookResource: NotebookResource,
        options: IDisplayOptions,
        promise:
            | Promise<{
                  kernel: IBaseKernel;
                  deadKernelAction?:
                      | 'deadKernelNeedsToBeRestarted'
                      | 'deadKernelWasNoRestarted'
                      | 'deadKernelWasRestarted';
              }>
            | Promise<{
                  kernel: IKernel;
                  deadKernelAction?:
                      | 'deadKernelNeedsToBeRestarted'
                      | 'deadKernelWasNoRestarted'
                      | 'deadKernelWasRestarted';
              }>,
        actionSource: KernelActionSource,
        onAction: (action: KernelAction, kernel: IBaseKernel) => void,
        disposables: IDisposable[],
        kernelWasRestartedDueToDeadKernel?: { kernelWasRestartedDueToDeadKernel: Deferred<boolean> }
    ): Promise<IKernel | IBaseKernel> {
        const info = await promise;
        const { kernel, deadKernelAction } = info;
        // Before returning, but without disposing the kernel, double check it's still valid
        // If a restart didn't happen, then we can't connect. Throw an error.
        // Do this outside of the loop so that subsequent calls will still ask because the kernel isn't disposed
        if (isKernelDead(kernel)) {
            // If the kernel is dead, then remove the cached promise, & try to get the kernel again.
            // At that point, it will get restarted.
            this.deleteKernelInfo(notebookResource, promise);
            if (deadKernelAction === 'deadKernelWasNoRestarted') {
                throw new KernelDeadError(kernel.kernelConnectionMetadata);
            } else if (deadKernelAction === 'deadKernelWasRestarted') {
                throw new KernelDeadError(kernel.kernelConnectionMetadata);
            } else if (kernelWasRestartedDueToDeadKernel?.kernelWasRestartedDueToDeadKernel.value === true) {
                throw new KernelDeadError(kernel.kernelConnectionMetadata);
            }
            info.deadKernelAction = 'deadKernelWasRestarted';
            // Kernel is dead and we didn't prompt the user to restart it, hence re-run the code that will prompt the user for a restart.
            const deferred = createDeferred<boolean>();
            deferred.resolve(true);
            kernelWasRestartedDueToDeadKernel = kernelWasRestartedDueToDeadKernel || {
                kernelWasRestartedDueToDeadKernel: deferred
            };
            return KernelConnector.wrapKernelMethod(
                kernel.kernelConnectionMetadata,
                'start',
                actionSource,
                serviceContainer,
                notebookResource,
                options,
                disposables,
                onAction,
                kernelWasRestartedDueToDeadKernel
            );
        }
        return kernel;
    }

    public static async wrapKernelMethod(
        metadata: KernelConnectionMetadata,
        initialContext: KernelAction,
        actionSource: KernelActionSource,
        serviceContainer: IServiceContainer,
        notebookResource: NotebookResource,
        options: IDisplayOptions,
        disposables: IDisposable[],
        onAction: (action: KernelAction, kernel: IBaseKernel | IKernel) => void = () => noop(),
        kernelWasRestartedDueToDeadKernel?: { kernelWasRestartedDueToDeadKernel: Deferred<boolean> }
    ): Promise<IBaseKernel | IKernel> {
        let currentPromise = this.getKernelInfo(notebookResource);
        if (!options.disableUI && currentPromise?.options.disableUI) {
            currentPromise.options.disableUI = false;
        }
        // If the current kernel has been disposed or in the middle of being disposed, then create another one.
        // But do that only if we require a UI, else we can just use the current one.
        if (
            !options.disableUI &&
            currentPromise?.kernel.resolved &&
            (currentPromise?.kernel.value?.kernel?.disposed || currentPromise?.kernel.value?.kernel?.disposing)
        ) {
            this.deleteKernelInfo(notebookResource);
            currentPromise = undefined;
        }

        // Wrap the kernel method again to interrupt/restart this kernel.
        if (currentPromise && initialContext !== 'restart' && initialContext !== 'interrupt') {
            return KernelConnector.verifyKernelState(
                serviceContainer,
                notebookResource,
                options,
                currentPromise.kernel.promise,
                actionSource,
                onAction,
                disposables
            );
        }

        logger.debug(
            `${initialContext} the kernel, options.disableUI=${options.disableUI} for ${getDisplayPath(
                'notebook' in notebookResource ? notebookResource.notebook.uri : notebookResource.resource
            )}`
        );

        kernelWasRestartedDueToDeadKernel = kernelWasRestartedDueToDeadKernel || {
            kernelWasRestartedDueToDeadKernel: createDeferred<boolean>()
        };
        const promise = KernelConnector.wrapKernelMethodImpl(
            metadata,
            initialContext,
            serviceContainer,
            notebookResource,
            options,
            actionSource,
            onAction,
            kernelWasRestartedDueToDeadKernel
        );
        if (kernelWasRestartedDueToDeadKernel?.kernelWasRestartedDueToDeadKernel.resolved) {
            kernelWasRestartedDueToDeadKernel.kernelWasRestartedDueToDeadKernel.resolve(true);
        }
        const deferred = createDeferredFromPromise(promise);
        deferred.promise.catch(noop);
        // If the kernel gets disposed or we fail to create the kernel, then ensure we remove the cached result.
        promise
            .then((result) => {
                result.kernel.onDisposed(
                    () => {
                        this.deleteKernelInfo(notebookResource, deferred.promise);
                    },
                    undefined,
                    disposables
                );
            })
            .catch(() => {
                this.deleteKernelInfo(notebookResource, deferred.promise);
            });

        this.setKernelInfo(notebookResource, deferred, options);
        return KernelConnector.verifyKernelState(
            serviceContainer,
            notebookResource,
            options,
            deferred.promise,
            actionSource,
            onAction,
            disposables,
            kernelWasRestartedDueToDeadKernel
        );
    }
    private static getKernelInfo(notebookResource: NotebookResource) {
        return 'notebook' in notebookResource
            ? KernelConnector.connectionsByNotebook.get(notebookResource.notebook)
            : KernelConnector.connectionsByUri.get(notebookResource.resource.toString());
    }
    private static setKernelInfo(
        notebookResource: NotebookResource,
        deferred: Deferred<{
            kernel: IBaseKernel;
            deadKernelAction?:
                | 'deadKernelNeedsToBeRestarted'
                | 'deadKernelWasNoRestarted'
                | 'deadKernelWasRestarted'
                | undefined;
        }>,
        options: IDisplayOptions
    ) {
        if ('notebook' in notebookResource) {
            KernelConnector.connectionsByNotebook.set(notebookResource.notebook, {
                kernel: deferred as Deferred<{
                    kernel: IKernel;
                    deadKernelAction?:
                        | 'deadKernelNeedsToBeRestarted'
                        | 'deadKernelWasNoRestarted'
                        | 'deadKernelWasRestarted'
                        | undefined;
                }>,
                options
            });
        } else {
            KernelConnector.connectionsByUri.set(notebookResource.resource.toString(), { kernel: deferred, options });
        }
    }
    private static deleteKernelInfo(
        notebookResource: NotebookResource,
        matchingKernelPromise?: Promise<{
            kernel: IBaseKernel;
            deadKernelAction?:
                | 'deadKernelNeedsToBeRestarted'
                | 'deadKernelWasNoRestarted'
                | 'deadKernelWasRestarted'
                | undefined;
        }>
    ) {
        if (!matchingKernelPromise) {
            if ('notebook' in notebookResource) {
                KernelConnector.connectionsByNotebook.delete(notebookResource.notebook);
            } else {
                KernelConnector.connectionsByUri.delete(notebookResource.resource.toString());
            }
            return;
        }
        if (
            'notebook' in notebookResource &&
            KernelConnector.connectionsByNotebook.get(notebookResource.notebook)?.kernel.promise ===
                matchingKernelPromise
        ) {
            KernelConnector.connectionsByNotebook.delete(notebookResource.notebook);
        } else if (
            notebookResource.resource &&
            KernelConnector.connectionsByUri.get(notebookResource.resource.toString())?.kernel.promise ===
                matchingKernelPromise
        ) {
            KernelConnector.connectionsByUri.delete(notebookResource.resource.toString());
        }
    }

    private static verifyWeCanStartKernel(metadata: KernelConnectionMetadata, serviceContainer: IServiceContainer) {
        if (!isLocalConnection(metadata) || !metadata.kernelSpec.specFile) {
            return;
        }
        const trustedKernelPaths = serviceContainer.get<ITrustedKernelPaths>(ITrustedKernelPaths);
        if (!trustedKernelPaths.isTrusted(Uri.file(metadata.kernelSpec.specFile))) {
            throw new KernelSpecNotTrustedError(metadata);
        }
    }

    private static async wrapKernelMethodImpl(
        metadata: KernelConnectionMetadata,
        initialContext: KernelAction,
        serviceContainer: IServiceContainer,
        notebookResource: NotebookResource,
        options: IDisplayOptions,
        actionSource: KernelActionSource,
        onAction: (action: KernelAction, kernel: IBaseKernel) => void,
        kernelWasRestartedDueToDeadKernel?: { kernelWasRestartedDueToDeadKernel: Deferred<boolean> }
    ): Promise<{
        kernel: IBaseKernel | IKernel;
        deadKernelAction?: 'deadKernelNeedsToBeRestarted' | 'deadKernelWasNoRestarted';
    }> {
        const kernelProvider = serviceContainer.get<IKernelProvider>(IKernelProvider);
        const thirdPartyKernelProvider = serviceContainer.get<IThirdPartyKernelProvider>(IThirdPartyKernelProvider);
        let kernel: IBaseKernel | undefined;
        let currentMethod = KernelConnector.convertContextToFunction(initialContext, options);
        let currentContext = initialContext;
        let controller = 'controller' in notebookResource ? notebookResource.controller : undefined;
        if (initialContext === 'start') {
            KernelConnector.verifyWeCanStartKernel(metadata, serviceContainer);
        }
        while (kernel === undefined) {
            if ('notebook' in notebookResource && notebookResource.notebook.isClosed) {
                throw new CancellationError();
            }
            // Try to create the kernel (possibly again)
            kernel =
                'notebook' in notebookResource
                    ? kernelProvider.getOrCreate(notebookResource.notebook, {
                          metadata,
                          controller: controller || notebookResource.controller,
                          resourceUri: notebookResource.resource
                      })
                    : thirdPartyKernelProvider.getOrCreate(notebookResource.resource, {
                          metadata,
                          resourceUri: notebookResource.resource
                      });

            let attemptedToRestart = false;
            try {
                // If the kernel is dead, ask the user if they want to restart.
                // We need to perform this check first, as its possible we'd call this method for dead kernels.
                // & if the kernel is dead, prompt to restart.
                if (initialContext !== 'restart' && isKernelDead(kernel) && !options.disableUI) {
                    attemptedToRestart = true;
                    const restarted = await KernelConnector.notifyAndRestartDeadKernel(kernel);
                    if (restarted && kernelWasRestartedDueToDeadKernel) {
                        kernelWasRestartedDueToDeadKernel.kernelWasRestartedDueToDeadKernel.resolve(true);
                    }
                    return {
                        kernel,
                        deadKernelAction: restarted ? 'deadKernelNeedsToBeRestarted' : 'deadKernelWasNoRestarted'
                    };
                } else {
                    onAction(currentContext, kernel);
                    await currentMethod(kernel);

                    if ('notebook' in notebookResource && notebookResource.notebook.isClosed) {
                        throw new CancellationError();
                    }

                    // If the kernel is dead, ask the user if they want to restart
                    if (isKernelDead(kernel) && !options.disableUI && currentContext !== 'interrupt') {
                        await KernelConnector.notifyAndRestartDeadKernel(kernel);
                    }
                }
            } catch (error) {
                if (attemptedToRestart && kernelWasRestartedDueToDeadKernel) {
                    kernelWasRestartedDueToDeadKernel.kernelWasRestartedDueToDeadKernel.resolve(true);
                }

                if (!isCancellationError(error)) {
                    logger.warn(
                        `Error occurred while trying to ${currentContext} the kernel, options.disableUI=${options.disableUI}`,
                        error
                    );
                }
                if (options.disableUI) {
                    throw error;
                }
                if ('notebook' in notebookResource && notebookResource.notebook.isClosed) {
                    throw new CancellationError();
                }

                const result = await KernelConnector.handleKernelError(
                    serviceContainer,
                    error,
                    currentContext,
                    notebookResource.resource,
                    kernel,
                    controller,
                    metadata,
                    actionSource
                );
                controller = result.controller;
                metadata = result.metadata;
                // When we wrap around, update the current method to start. This
                // means if we're handling a restart or an interrupt that fails, we move onto trying to start the kernel.
                currentMethod = (k) => k.start(options);
                currentContext = 'start';

                if (actionSource === '3rdPartyExtension') {
                    // Rethrow the error to the 3rd party caller & do not retry.
                    throw error;
                } else {
                    // Since an error occurred, we have to try again (controller may have switched so we have to pick a new kernel)
                    kernel = undefined;
                }
            }
        }
        return { kernel };
    }

    public static async connectToNotebookKernel(
        metadata: KernelConnectionMetadata,
        serviceContainer: IServiceContainer,
        notebookResource: { resource: Resource; notebook: NotebookDocument; controller: IKernelController },
        options: IDisplayOptions,
        disposables: IDisposable[],
        actionSource: KernelActionSource = 'jupyterExtension',
        onAction: (action: KernelAction, kernel: IKernel) => void = () => noop()
    ): Promise<IKernel> {
        return KernelConnector.wrapKernelMethod(
            metadata,
            'start',
            actionSource,
            serviceContainer,
            notebookResource,
            options,
            disposables,
            onAction as (action: KernelAction, kernel: IBaseKernel) => void
        ) as Promise<IKernel>;
    }

    public static async connectToKernel(
        metadata: KernelConnectionMetadata,
        serviceContainer: IServiceContainer,
        resource: { resource: Uri },
        options: IDisplayOptions,
        disposables: IDisposable[],
        actionSource: KernelActionSource = 'jupyterExtension',
        onAction: (action: KernelAction, kernel: IBaseKernel) => void = () => noop()
    ): Promise<IBaseKernel> {
        return KernelConnector.wrapKernelMethod(
            metadata,
            'start',
            actionSource,
            serviceContainer,
            resource,
            options,
            disposables,
            onAction
        );
    }
}

type NotebookResource =
    | { resource: Resource; notebook: NotebookDocument; controller: IKernelController }
    | { resource: Uri };
