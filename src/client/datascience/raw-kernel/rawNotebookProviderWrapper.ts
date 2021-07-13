// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import '../../common/extensions';

import { IAsyncDisposableRegistry, Resource } from '../../common/types';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import {
    ConnectNotebookProviderOptions,
    INotebook,
    IRawConnection,
    IRawNotebookProvider,
    IRawNotebookSupportedService
} from '../types';
import { RawNotebookProviderBase } from './rawNotebookProvider';

interface IRawNotebookProviderInterface extends IRawNotebookProvider {}

// This class wraps either a HostRawNotebookProvider or a GuestRawNotebookProvider based on the liveshare state. It abstracts
// out the live share specific parts.
@injectable()
export class RawNotebookProviderWrapper implements IRawNotebookProvider {
    private serverFactory: IRawNotebookProviderInterface;

    constructor(
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IRawNotebookSupportedService) rawNotebookSupported: IRawNotebookSupportedService
    ) {
        // The server factory will create the appropriate HostRawNotebookProvider or GuestRawNotebookProvider based on
        // the liveshare state.
        this.serverFactory = new RawNotebookProviderBase(asyncRegistry, rawNotebookSupported);
    }

    public async supported(): Promise<boolean> {
        return this.serverFactory.supported();
    }

    public async connect(options: ConnectNotebookProviderOptions): Promise<IRawConnection | undefined> {
        return this.serverFactory.connect(options);
    }

    public async createNotebook(
        identity: Uri,
        resource: Resource,
        disableUI: boolean,
        notebookMetadata: nbformat.INotebookMetadata,
        kernelConnection: KernelConnectionMetadata,
        cancelToken: CancellationToken
    ): Promise<INotebook> {
        return this.serverFactory.createNotebook(
            identity,
            resource,
            disableUI,
            notebookMetadata,
            kernelConnection,
            cancelToken
        );
    }

    public async getNotebook(identity: Uri): Promise<INotebook | undefined> {
        return this.serverFactory.getNotebook(identity);
    }

    public async dispose(): Promise<void> {
        return this.serverFactory.dispose();
    }
}
