// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable, multiInject } from 'inversify';
import { IApplicationShell, IVSCodeNotebook } from '../platform/common/application/types';
import { InteractiveWindowView } from '../platform/common/constants';
import { NotebookDocument, Uri } from 'vscode';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IExtensionContext
} from '../platform/common/types';
import { BaseCoreKernelProvider, BaseThirdPartyKernelProvider } from './kernelProvider.base';
import { Kernel, ThirdPartyKernel } from './kernel';
import {
    IThirdPartyKernel,
    IKernel,
    INotebookProvider,
    IStartupCodeProvider,
    ITracebackFormatter,
    KernelOptions,
    ThirdPartyKernelOptions
} from './types';
import { IJupyterServerUriStorage } from './jupyter/types';
import { createKernelSettings } from './kernelSettings';

/**
 * Web version of a kernel provider. Needed in order to create the web version of a kernel.
 */
@injectable()
export class KernelProvider extends BaseCoreKernelProvider {
    constructor(
        @inject(IAsyncDisposableRegistry) asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IVSCodeNotebook) notebook: IVSCodeNotebook,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IJupyterServerUriStorage) jupyterServerUriStorage: IJupyterServerUriStorage,
        @multiInject(ITracebackFormatter) private readonly formatters: ITracebackFormatter[],
        @multiInject(IStartupCodeProvider) private readonly startupCodeProviders: IStartupCodeProvider[]
    ) {
        super(asyncDisposables, disposables, notebook);
        disposables.push(jupyterServerUriStorage.onDidRemoveUris(this.handleUriRemoval.bind(this)));
    }

    public getOrCreate(notebook: NotebookDocument, options: KernelOptions): IKernel {
        const uri = notebook.uri;
        const existingKernelInfo = this.getInternal(notebook);
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }
        this.disposeOldKernel(notebook);

        const resourceUri = notebook?.notebookType === InteractiveWindowView ? options.resourceUri : uri;
        const kernel = new Kernel(
            uri,
            resourceUri,
            notebook,
            options.metadata,
            this.notebookProvider,
            createKernelSettings(this.configService, resourceUri),
            this.appShell,
            options.controller,
            this.context,
            this.formatters,
            this.startupCodeProviders,
            () => Promise.resolve()
        ) as IKernel;
        kernel.onRestarted(() => this._onDidRestartKernel.fire(kernel), this, this.disposables);
        kernel.onDisposed(() => this._onDidDisposeKernel.fire(kernel), this, this.disposables);
        kernel.onStarted(() => this._onDidStartKernel.fire(kernel), this, this.disposables);
        kernel.onStatusChanged(
            (status) => this._onKernelStatusChanged.fire({ kernel, status }),
            this,
            this.disposables
        );
        this.asyncDisposables.push(kernel);
        this.storeKernel(notebook, options, kernel);

        this.deleteMappingIfKernelIsDisposed(uri, kernel);
        return kernel;
    }
}

@injectable()
export class ThirdPartyKernelProvider extends BaseThirdPartyKernelProvider {
    constructor(
        @inject(IAsyncDisposableRegistry) asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IVSCodeNotebook) notebook: IVSCodeNotebook,
        @multiInject(IStartupCodeProvider) private readonly startupCodeProviders: IStartupCodeProvider[]
    ) {
        super(asyncDisposables, disposables, notebook);
    }

    public getOrCreate(uri: Uri, options: ThirdPartyKernelOptions): IThirdPartyKernel {
        const existingKernelInfo = this.getInternal(uri);
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }
        this.disposeOldKernel(uri);

        const resourceUri = uri;
        const kernel = new ThirdPartyKernel(
            uri,
            resourceUri,
            options.metadata,
            this.notebookProvider,
            this.appShell,
            createKernelSettings(this.configService, resourceUri),
            this.startupCodeProviders
        );
        kernel.onRestarted(() => this._onDidRestartKernel.fire(kernel), this, this.disposables);
        kernel.onDisposed(() => this._onDidDisposeKernel.fire(kernel), this, this.disposables);
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
