// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';
import { ConfigurationTarget, Event, EventEmitter, Memento, workspace, window, ViewColumn } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';

import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IWorkspaceService
} from '../../common/application/types';
import { JVSC_EXTENSION_ID } from '../../common/constants';
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
    Resource
} from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { IServiceContainer } from '../../ioc/types';
import { IExportDialog } from '../export/types';
import { IKernelProvider } from '../jupyter/kernels/types';
import { INotebookControllerManager } from '../notebook/types';
import {
    IInteractiveWindow,
    IInteractiveWindowProvider,
    IJupyterDebugger,
    INotebookExporter,
    IStatusProvider
} from '../types';
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
        return this._windows.find(
            (win) => win.notebookUri.toString() === window.activeNotebookEditor?.document.uri.toString()
        );
    }
    public get windows(): ReadonlyArray<IInteractiveWindow> {
        return this._windows;
    }
    private readonly _onDidChangeActiveInteractiveWindow = new EventEmitter<IInteractiveWindow | undefined>();
    private readonly _onDidCreateInteractiveWindow = new EventEmitter<IInteractiveWindow>();
    private lastActiveInteractiveWindow: IInteractiveWindow | undefined;
    private _windows: NativeInteractiveWindow[] = [];
    private mapOfResourcesToInteractiveWindowPromises = new Map<string, Promise<NativeInteractiveWindow>>();

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {
        asyncRegistry.push(this);
    }

    public async getOrCreate(resource: Resource): Promise<IInteractiveWindow> {
        if (!this.workspaceService.isTrusted) {
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
            result = await this.create(resource, mode);
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

    private async createInteractiveWindowPromise(resource: Resource, mode: InteractiveWindowMode) {
        return this.getControllerForInteractiveWindow()
            .then((preferredControllerId) => {
                const hasOwningFile = resource !== undefined;
                return (this.commandManager.executeCommand(
                    'interactive.open',
                    // Keep focus on the owning file if there is one
                    { viewColumn: ViewColumn.Beside, preserveFocus: hasOwningFile },
                    undefined,
                    preferredControllerId
                ) as unknown) as INativeInteractiveWindow;
            })
            .then(({ notebookUri }: INativeInteractiveWindow) => {
                const notebookDocument = workspace.notebookDocuments.find(
                    (doc) => doc.uri.toString() === notebookUri.toString()
                );
                if (!notebookDocument) {
                    // This means VS Code failed to create an interactive window.
                    // This should never happen.
                    throw new Error('Failed to request creation of interactive window from VS Code.');
                }
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
                    notebookDocument,
                    this.notebookControllerManager,
                    this.kernelProvider,
                    this.disposables,
                    this.serviceContainer.get<IJupyterDebugger>(IJupyterDebugger)
                );
                this._windows.push(result);

                // This is the last interactive window at the moment (as we're about to create it)
                this.lastActiveInteractiveWindow = result;

                // When shutting down, we fire an event
                const handler = result.closed(this.onInteractiveWindowClosed);
                this.disposables.push(result);
                this.disposables.push(handler);
                this.disposables.push(
                    result.onDidChangeViewState(this.raiseOnDidChangeActiveInteractiveWindow.bind(this))
                );

                // fire created event
                this._onDidCreateInteractiveWindow.fire(result);
                return result;
            });
    }

    protected async create(resource: Resource, mode: InteractiveWindowMode): Promise<NativeInteractiveWindow> {
        // If there's no resource, just create a new one
        if (resource === undefined) {
            return this.createInteractiveWindowPromise(resource, mode);
        }

        const existingPromise = this.mapOfResourcesToInteractiveWindowPromises.get(resource.toString());
        // If there's a resource and no existing promise, create a new one
        if (existingPromise === undefined) {
            const promise = this.createInteractiveWindowPromise(resource, mode);
            this.mapOfResourcesToInteractiveWindowPromises.set(resource.toString(), promise);
            return promise;
        } else {
            // Otherwise return existing promise
            return existingPromise;
        }
    }

    private async getInteractiveMode(resource: Resource): Promise<InteractiveWindowMode> {
        let result = this.configService.getSettings(resource).interactiveWindowMode;

        // Ask user if still at default value and they're opening a second file.
        if (
            result === 'multiple' &&
            resource &&
            !this.globalMemento.get(AskedForPerFileSettingKey) &&
            this._windows.length === 1 &&
            // Only prompt if the submitting file is different
            this._windows[0].owner?.fsPath !== resource.fsPath
        ) {
            // See if the first window was tied to a file or not.
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
                this._windows[0].changeMode(result);
                await this.configService.updateSetting(
                    'interactiveWindowMode',
                    result,
                    resource,
                    ConfigurationTarget.Global
                );
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

    private async getControllerForInteractiveWindow(): Promise<string | undefined> {
        const preferredController = await this.notebookControllerManager.getInteractiveController();
        return preferredController ? `${JVSC_EXTENSION_ID}/${preferredController.id}` : undefined;
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
        if (interactiveWindow.owner !== undefined) {
            // Make sure we don't try to reuse the promise for an interactive window which has already been disposed
            this.mapOfResourcesToInteractiveWindowPromises.delete(interactiveWindow.owner.toString());
        }
        this.raiseOnDidChangeActiveInteractiveWindow();
    };
}
