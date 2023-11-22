// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { CancellationTokenSource, Memento, NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IVSCodeNotebook, IWorkspaceService } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfo, traceError } from '../../../platform/logging';
import {
    IConfigurationService,
    IDisposableRegistry,
    IMemento,
    WORKSPACE_MEMENTO
} from '../../../platform/common/types';
import { getKernelConnectionLanguage } from '../../helpers';
import { IKernel, IKernelProvider, IJupyterServerConnector } from '../../types';
import { DisplayOptions } from '../../displayOptions';
import { IRawNotebookSupportedService } from '../../raw/types';
import { isJupyterNotebook } from '../../../platform/common/utils';
import { noop } from '../../../platform/common/utils/misc';

const LastPythonNotebookCreatedKey = 'last-python-notebook-created';
const LastNotebookCreatedKey = 'last-notebook-created';

/**
 * Class used for preloading a kernel. Makes first run of a kernel faster as it loads as soon as the extension does.
 */
@injectable()
export class ServerPreload implements IExtensionSyncActivationService {
    constructor(
        @inject(IVSCodeNotebook) notebook: IVSCodeNotebook,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IJupyterServerConnector) private serverConnector: IJupyterServerConnector,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IRawNotebookSupportedService) private readonly rawKernelSupport: IRawNotebookSupportedService,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private mementoStorage: Memento,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider
    ) {
        notebook.onDidOpenNotebookDocument(this.onDidOpenNotebook.bind(this), this, disposables);
    }
    public activate() {
        // This is the list of things that should cause us to start a local server
        // 1) Notebook is opened
        // 2) Notebook was opened in the past 7 days
        // 3) Interactive window was opened in the past 7 days
        // 4) Interactive window is opened
        // And the user has specified local server in their settings.
        this.checkDateForServerStart();

        this.disposables.push(this.kernelProvider.onDidStartKernel(this.kernelStarted, this));
    }

    private get lastNotebookCreated() {
        const time = this.mementoStorage.get<number | undefined>(LastNotebookCreatedKey);
        return time ? new Date(time) : undefined;
    }

    private checkDateForServerStart() {
        if (this.shouldAutoStartStartServer(this.lastNotebookCreated)) {
            this.createServerIfNecessary().catch(noop);
        }
    }
    private shouldAutoStartStartServer(lastTime?: Date) {
        if (!lastTime) {
            return false;
        }
        const currentTime = new Date();
        const diff = currentTime.getTime() - lastTime.getTime();
        const diffInDays = Math.floor(diff / (24 * 3600 * 1000));
        return diffInDays <= 7;
    }

    private async createServerIfNecessary() {
        if (!this.workspace.isTrusted || (await this.rawKernelSupport.isSupported)) {
            return;
        }
        const source = new CancellationTokenSource();
        const ui = new DisplayOptions(true);
        try {
            traceInfo(`Attempting to start a server because of preload conditions ...`);

            // If it didn't start, attempt for local and if allowed.
            if (!this.configService.getSettings(undefined).disableJupyterAutoStart) {
                // Local case, try creating one
                await this.serverConnector.connect({
                    resource: undefined,
                    ui,
                    token: source.token
                });
            }
        } catch (exc) {
            traceError(`Error starting server in serverPreload: `, exc);
        } finally {
            ui.dispose();
            source.dispose();
        }
    }

    private onDidOpenNotebook(doc: NotebookDocument) {
        if (!isJupyterNotebook(doc)) {
            return;
        }
        // Automatically start a server whenever we open a notebook
        this.createServerIfNecessary().catch(noop);
    }

    // Callback for when a notebook is created by the notebook provider
    // Note the time as well as an extra time for python specific notebooks
    private kernelStarted(kernel: IKernel) {
        const language = getKernelConnectionLanguage(kernel.kernelConnectionMetadata);

        this.mementoStorage.update(LastNotebookCreatedKey, Date.now()).then(noop, noop);

        if (language === PYTHON_LANGUAGE) {
            this.mementoStorage.update(LastPythonNotebookCreatedKey, Date.now()).then(noop, noop);
        }
    }
}
