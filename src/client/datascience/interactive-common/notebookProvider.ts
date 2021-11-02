// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { IWorkspaceService } from '../../common/application/types';
import { IConfigurationService, IDisposableRegistry, Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { Identifiers, Settings, Telemetry } from '../constants';
import { sendKernelTelemetryWhenDone, trackKernelResourceInformation } from '../telemetry/telemetry';
import {
    ConnectNotebookProviderOptions,
    GetNotebookOptions,
    IJupyterNotebookProvider,
    INotebook,
    INotebookProvider,
    INotebookProviderConnection,
    IRawNotebookProvider
} from '../types';

@injectable()
export class NotebookProvider implements INotebookProvider {
    private readonly notebooks = new Map<string, Promise<INotebook>>();
    public get activeNotebooks() {
        return [...this.notebooks.values()];
    }
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IRawNotebookProvider) private readonly rawNotebookProvider: IRawNotebookProvider,
        @inject(IJupyterNotebookProvider) private readonly jupyterNotebookProvider: IJupyterNotebookProvider,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}

    // Attempt to connect to our server provider, and if we do, return the connection info
    public async connect(options: ConnectNotebookProviderOptions): Promise<INotebookProviderConnection | undefined> {
        const settings = this.configService.getSettings(undefined);
        const serverType: string | undefined = settings.jupyterServerType;

        // Connect to either a jupyter server or a stubbed out raw notebook "connection"
        if (this.rawNotebookProvider.isSupported) {
            return this.rawNotebookProvider.connect({
                ...options
            });
        } else if (
            this.extensionChecker.isPythonExtensionInstalled ||
            serverType === Settings.JupyterServerRemoteLaunch
        ) {
            return this.jupyterNotebookProvider.connect({
                ...options
            });
        } else if (!options.getOnly) {
            await this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }
    }
    public async getOrCreateNotebook(options: GetNotebookOptions): Promise<INotebook | undefined> {
        const rawKernel = this.rawNotebookProvider.isSupported;

        // Check our own promise cache
        if (this.notebooks.get(options.document.toString())) {
            return this.notebooks.get(options.document.toString())!!;
        }

        // Check to see if our provider already has this notebook
        const notebook = rawKernel
            ? await this.rawNotebookProvider.getNotebook(options.document, options.token)
            : await this.jupyterNotebookProvider.getNotebook(options);
        if (notebook && !notebook.session.disposed) {
            this.cacheNotebookPromise(options.document, Promise.resolve(notebook));
            return notebook;
        }

        // If get only, don't create a notebook
        if (options.getOnly) {
            return undefined;
        }

        // We want to cache a Promise<INotebook> from the create functions
        // but jupyterNotebookProvider.createNotebook can be undefined if the server is not available
        // so check for our connection here first
        if (!rawKernel) {
            if (!(await this.jupyterNotebookProvider.connect(options))) {
                return undefined;
            }
        }

        // Finally create if needed
        let resource: Resource = options.resource;
        // TODO: This is a bug, this will never be true, `options.document.uri.scheme will never be Identifiers.HistoryPurpose`
        if (options.document.uri.scheme === Identifiers.HistoryPurpose && !resource) {
            // If we have any workspaces, then use the first available workspace.
            // This is required, else using `undefined` as a resource when we have worksapce folders is a different meaning.
            // This means interactive window doesn't properly support mult-root workspaces as we pick first workspace.
            // Ideally we need to pick the resource of the corresponding Python file.
            resource = this.workspaceService.hasWorkspaceFolders
                ? this.workspaceService.workspaceFolders![0]!.uri
                : undefined;
        }

        trackKernelResourceInformation(resource, { kernelConnection: options.kernelConnection });
        const promise = rawKernel
            ? this.rawNotebookProvider.createNotebook(
                  options.document,
                  resource,
                  options.kernelConnection,
                  options.disableUI,
                  options.token
              )
            : this.jupyterNotebookProvider.createNotebook(options);

        sendKernelTelemetryWhenDone(resource, Telemetry.NotebookStart, promise, undefined, {
            disableUI: options.disableUI
        });

        this.cacheNotebookPromise(options.document, promise);

        return promise;
    }

    // Cache the promise that will return a notebook
    private cacheNotebookPromise(document: NotebookDocument, promise: Promise<INotebook>) {
        this.notebooks.set(document.uri.toString(), promise);

        // Remove promise from cache if the same promise still exists.
        const removeFromCache = () => {
            const cachedPromise = this.notebooks.get(document.uri.toString());
            if (cachedPromise === promise) {
                this.notebooks.delete(document.uri.toString());
            }
        };

        promise
            .then((nb) => {
                // If the notebook is disposed, remove from cache.
                nb.session.onDidDispose(removeFromCache, this, this.disposables);
            })
            .catch(noop);

        // If promise fails, then remove the promise from cache.
        promise.catch(removeFromCache);
    }
}
