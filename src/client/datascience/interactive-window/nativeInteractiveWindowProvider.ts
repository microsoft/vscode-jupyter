// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';
import { ConfigurationTarget, Event, EventEmitter, Memento, NotebookDocument, Uri, ViewColumn } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';

import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IWorkspaceService
} from '../../common/application/types';
import { traceInfo } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';

import {
    GLOBAL_MEMENTO,
    IAsyncDisposable,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IMemento,
    InteractiveWindowMode,
    Resource} from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { IServiceContainer } from '../../ioc/types';
import { IExportDialog } from '../export/types';
import { IKernelProvider } from '../jupyter/kernels/types';
import { InteractiveWindowView } from '../notebook/constants';
import { INotebookControllerManager } from '../notebook/types';
import { VSCodeNotebookController } from '../notebook/vscodeNotebookController';
import {
    IInteractiveWindow,
    IInteractiveWindowProvider,
    INotebookExporter,
    IStatusProvider} from '../types';
import { NativeInteractiveWindow } from './nativeInteractiveWindow';
import { INativeInteractiveWindow } from './types';

// Export for testing
export const AskedForPerFileSettingKey = 'ds_asked_per_file_interactive';

@injectable()
export class NativeInteractiveWindowProvider implements IInteractiveWindowProvider, IAsyncDisposable {
    public get onDidChangeActiveInteractiveWindow(): Event<IInteractiveWindow | undefined> {
        return this._onDidChangeActiveInteractiveWindow.event;
    }
    public get onDidCreateInteractiveWindow(): Event<IInteractiveWindow> {
        return this._onDidCreateInteractiveWindow.event;
    }
    public get activeWindow(): IInteractiveWindow | undefined {
        return this._windows.find((w) => w.active && w.visible);
    }
    public get windows(): ReadonlyArray<IInteractiveWindow> {
        return this._windows;
    }
    private readonly _onDidChangeActiveInteractiveWindow = new EventEmitter<IInteractiveWindow | undefined>();
    private readonly _onDidCreateInteractiveWindow = new EventEmitter<IInteractiveWindow>();
    private lastActiveInteractiveWindow: IInteractiveWindow | undefined;
    private _windows: NativeInteractiveWindow[] = [];
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager
    ) {
        asyncRegistry.push(this);

        this.notebookControllerManager.onNotebookControllerSelected(this.handleNotebookControllerSelected, this, this.disposables);
    }

    public async getOrCreate(resource: Resource): Promise<IInteractiveWindow> {
        if (!this.workspace.isTrusted) {
            // This should not happen, but if it does, then just throw an error.
            // The commands the like should be disabled.
            throw new Error('Worksapce not trusted');
        }
        // Ask for a configuration change if appropriate
        const mode = await this.getInteractiveMode(resource);

        // See if we already have a match
        let result = this.get(resource, mode) as IInteractiveWindow;
        if (!result) {
            // No match. Create a new item.
            const { notebookUri } = await this.commandManager.executeCommand('interactive.open', ViewColumn.Beside) as INativeInteractiveWindow;
            result = this.create(resource, mode, notebookUri);
        }

        return result;
    }

    public async dispose(): Promise<void> {
        return noop();
    }

    public async synchronize(_window: IInteractiveWindow): Promise<void> {
        // TODO delete this method entirely
        noop();
    }

    protected create(resource: Resource, mode: InteractiveWindowMode, notebookUri: Uri): IInteractiveWindow {
        // Set it as soon as we create it. The .ctor for the interactive window
        // may cause a subclass to talk to the IInteractiveWindowProvider to get the active interactive window.
        const result = new NativeInteractiveWindow(
            this.serviceContainer.get<IApplicationShell>(IApplicationShell),
            this.serviceContainer.get<IDocumentManager>(IDocumentManager),
            this.serviceContainer.get<IStatusProvider>(IStatusProvider),
            this.serviceContainer.get<IFileSystem>(IFileSystem),
            this.serviceContainer.get<IConfigurationService>(IConfigurationService),
            this.serviceContainer.get<ICommandManager>(ICommandManager),
            this.serviceContainer.get<INotebookExporter>(INotebookExporter),
            this.serviceContainer.get<IWorkspaceService>(IWorkspaceService),
            resource,
            mode,
            this.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker),
            this.serviceContainer.get<IExportDialog>(IExportDialog),
            notebookUri,
            this.notebookControllerManager,
            this.kernelProvider
        );
        this._windows.push(result);

        // This is the last interactive window at the moment (as we're about to create it)
        this.lastActiveInteractiveWindow = result;

        // When shutting down, we fire an event
        const handler = result.closed(this.onInteractiveWindowClosed);
        this.disposables.push(result);
        this.disposables.push(handler);
        this.disposables.push(result.onDidChangeViewState(this.raiseOnDidChangeActiveInteractiveWindow.bind(this)));

        // Show in the background
        result.show().ignoreErrors();

        // fire created event
        this._onDidCreateInteractiveWindow.fire(result);

        return result;
    }

    private async handleNotebookControllerSelected(e: { notebook: NotebookDocument, controller: VSCodeNotebookController }) {
        // For now, VS Code does not provide a way to query the window for activeInteractiveEditors
        // or the workspace for activeInteractiveDocuments (?). However, it is now possible for an
        // InteractiveEditor to be created via a builtin VS Code command i.e. without the Jupyter
        // extension's involvement, in which case the Jupyter extension only becomes aware of the
        // InteractiveEditor's existence when a Jupyter-contributed controller is selected for the
        // InteractiveEditor. Even if the InteractiveEditor wasn't created through the Jupyter
        // extension, our commands will continue to appear in the interactive toolbar and we need
        // to make sure they work. Therefore we should sign up for controller selection events and create
        // corresponding InteractiveWindows in order to handle kernel restart, interrupt, export etc.
        if (e.notebook.notebookType !== InteractiveWindowView) {
            return;
        }

        const existingInteractiveWindow = this._windows.find((interactiveWindow) => interactiveWindow.notebookUri.toString() === e.notebook.toString());

        if (existingInteractiveWindow === undefined) {
            // Ask for a configuration change if appropriate
            const mode = await this.getInteractiveMode(undefined); // TODO VS Code doesn't look at this setting
            this.create(undefined, mode, e.notebook.uri);
        }

        // Ensure the kernel starts ASAP
        const kernel = this.kernelProvider.getOrCreate(e.notebook.uri, {
            metadata: e.controller.connection,
            controller: e.controller.controller
        });
        await kernel?.start({ disableUI: false, document: e.notebook });
    }

    private async getInteractiveMode(resource: Resource): Promise<InteractiveWindowMode> {
        let result = this.configService.getSettings(resource).interactiveWindowMode;

        // Ask user if still at default value and they're opening a second file.
        if (
            result === 'multiple' &&
            resource &&
            !this.globalMemento.get(AskedForPerFileSettingKey) &&
            this._windows.length === 1
        ) {
            // See if the first window was tied to a file or not.
            const firstWindow = this._windows.find((w) => w.owner);
            if (firstWindow) {
                this.globalMemento.update(AskedForPerFileSettingKey, true).then(noop, noop);
                const questions = [
                    localize.DataScience.interactiveWindowModeBannerSwitchYes(),
                    localize.DataScience.interactiveWindowModeBannerSwitchNo()
                ];
                // Ask user if they'd like to switch to per file or not.
                const response = await this.appShell.showInformationMessage(
                    localize.DataScience.interactiveWindowModeBannerTitle(),
                    ...questions
                );
                if (response === questions[0]) {
                    result = 'perFile';
                    firstWindow.changeMode(result);
                    await this.configService.updateSetting(
                        'interactiveWindowMode',
                        result,
                        resource,
                        ConfigurationTarget.Global
                    );
                }
            }
        }
        return result;
    }

    private get(owner: Resource, interactiveMode: InteractiveWindowMode): IInteractiveWindow | undefined {
        // Single mode means there's only ever one.
        if (interactiveMode === 'single') {
            return this._windows.length > 0 ? this._windows[0] : undefined;
        }

        // Multiple means use last active window or create a new one
        // if not owned.
        if (interactiveMode === 'multiple') {
            // Owner being undefined means create a new window, othewise use
            // the last active window.
            return owner ? this.activeWindow || this.lastActiveInteractiveWindow || this._windows[0] : undefined;
        }

        // Otherwise match the owner.
        return this._windows.find((w) => {
            if (!owner && !w.owner) {
                return true;
            }
            if (owner && w.owner && this.fs.areLocalPathsSame(owner.fsPath, w.owner.fsPath)) {
                return true;
            }
            return false;
        });
    }

    // TODO: we don't currently have a way to know when the VS Code InteractiveEditor
    // view state changes. Requires API (interactive.open should return the InteractiveEditorPanel) 
    private raiseOnDidChangeActiveInteractiveWindow() {
        // Update last active window (remember changes to the active window)
        this.lastActiveInteractiveWindow = this.activeWindow ? this.activeWindow : this.lastActiveInteractiveWindow;
        this._onDidChangeActiveInteractiveWindow.fire(this.activeWindow);
    }

    private onInteractiveWindowClosed = (interactiveWindow: IInteractiveWindow) => {
        traceInfo(`Closing interactive window: ${interactiveWindow.title}`);
        this._windows = this._windows.filter((w) => w !== interactiveWindow);
        if (this.lastActiveInteractiveWindow === interactiveWindow) {
            this.lastActiveInteractiveWindow = this._windows[0];
        }
        this.raiseOnDidChangeActiveInteractiveWindow();
    };
}
