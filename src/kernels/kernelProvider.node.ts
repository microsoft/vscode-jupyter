// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, multiInject, named } from 'inversify';
import { Memento, NotebookDocument, Uri } from 'vscode';
import { IApplicationShell, IVSCodeNotebook } from '../platform/common/application/types';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IExperimentService,
    IExtensionContext,
    IMemento,
    WORKSPACE_MEMENTO
} from '../platform/common/types';
import { BaseCoreKernelProvider, BaseThirdPartyKernelProvider } from './kernelProvider.base';
import { InteractiveWindowView, JupyterNotebookView } from '../platform/common/constants';
import { Kernel, ThirdPartyKernel } from './kernel';
import {
    IThirdPartyKernel,
    IKernel,
    ITracebackFormatter,
    KernelOptions,
    ThirdPartyKernelOptions,
    IStartupCodeProviders,
    IKernelSessionFactory
} from './types';
import { IJupyterServerUriStorage } from './jupyter/types';
import { createKernelSettings } from './kernelSettings';
import { NotebookKernelExecution } from './kernelExecution';

/**
 * Node version of a kernel provider. Needed in order to create the node version of a kernel.
 */
@injectable()
export class KernelProvider extends BaseCoreKernelProvider {
    constructor(
        @inject(IAsyncDisposableRegistry) asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IKernelSessionFactory) private sessionCreator: IKernelSessionFactory,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IVSCodeNotebook) notebook: IVSCodeNotebook,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IJupyterServerUriStorage) jupyterServerUriStorage: IJupyterServerUriStorage,
        @multiInject(ITracebackFormatter)
        private readonly formatters: ITracebackFormatter[],
        @inject(IStartupCodeProviders) private readonly startupCodeProviders: IStartupCodeProviders,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private readonly workspaceStorage: Memento,
        @inject(IExperimentService) private readonly experiments: IExperimentService
    ) {
        super(asyncDisposables, disposables, notebook);
        disposables.push(jupyterServerUriStorage.onDidRemove(this.handleUriRemoval.bind(this)));
    }

    public getOrCreate(notebook: NotebookDocument, options: KernelOptions): IKernel {
        const existingKernelInfo = this.getInternal(notebook);
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }
        this.disposeOldKernel(notebook);

        const resourceUri = notebook.notebookType === InteractiveWindowView ? options.resourceUri : notebook.uri;
        const settings = createKernelSettings(this.configService, resourceUri);
        const notebookType =
            notebook.uri.path.endsWith('.interactive') || options.resourceUri?.path.endsWith('.interactive')
                ? InteractiveWindowView
                : JupyterNotebookView;

        const kernel: IKernel = new Kernel(
            resourceUri,
            notebook,
            options.metadata,
            this.sessionCreator,
            settings,
            this.appShell,
            options.controller,
            this.startupCodeProviders.getProviders(notebookType),
            this.workspaceStorage,
            this.experiments
        );
        kernel.onRestarted(() => this._onDidRestartKernel.fire(kernel), this, this.disposables);
        kernel.onDisposed(
            () => {
                this._onDidDisposeKernel.fire(kernel);
            },
            this,
            this.disposables
        );
        kernel.onStarted(() => this._onDidStartKernel.fire(kernel), this, this.disposables);
        kernel.onStatusChanged(
            (status) => this._onKernelStatusChanged.fire({ kernel, status }),
            this,
            this.disposables
        );

        this.executions.set(
            kernel,
            new NotebookKernelExecution(kernel, this.appShell, this.context, this.formatters, notebook)
        );
        this.asyncDisposables.push(kernel);
        this.storeKernel(notebook, options, kernel);
        this.deleteMappingIfKernelIsDisposed(kernel);
        return kernel;
    }
}

@injectable()
export class ThirdPartyKernelProvider extends BaseThirdPartyKernelProvider {
    constructor(
        @inject(IAsyncDisposableRegistry) asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IKernelSessionFactory) private sessionCreator: IKernelSessionFactory,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IVSCodeNotebook) notebook: IVSCodeNotebook,
        @inject(IStartupCodeProviders) private readonly startupCodeProviders: IStartupCodeProviders,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private readonly workspaceStorage: Memento,
        @inject(IExperimentService) private readonly experiments: IExperimentService
    ) {
        super(asyncDisposables, disposables, notebook);
    }

    public getOrCreate(uri: Uri, options: ThirdPartyKernelOptions): IThirdPartyKernel {
        // const notebook = this.
        const existingKernelInfo = this.getInternal(uri);
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }
        this.disposeOldKernel(uri);

        const resourceUri = uri;
        const settings = createKernelSettings(this.configService, resourceUri);
        const notebookType = resourceUri.path.endsWith('.interactive') ? InteractiveWindowView : JupyterNotebookView;
        const kernel: IThirdPartyKernel = new ThirdPartyKernel(
            uri,
            resourceUri,
            options.metadata,
            this.sessionCreator,
            this.appShell,
            settings,
            this.startupCodeProviders.getProviders(notebookType),
            this.workspaceStorage,
            this.experiments
        );
        kernel.onRestarted(() => this._onDidRestartKernel.fire(kernel), this, this.disposables);
        kernel.onDisposed(
            () => {
                this._onDidDisposeKernel.fire(kernel);
            },
            this,
            this.disposables
        );
        kernel.onStarted(() => this._onDidStartKernel.fire(kernel), this, this.disposables);
        kernel.onStatusChanged(
            (status) => this._onKernelStatusChanged.fire({ kernel, status }),
            this,
            this.disposables
        );
        this.asyncDisposables.push(kernel);
        this.storeKernel(uri, options, kernel);
        this.deleteMappingIfKernelIsDisposed(uri, kernel);
        return kernel;
    }
}
