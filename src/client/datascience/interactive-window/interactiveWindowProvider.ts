// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';
import { ConfigurationTarget, Event, EventEmitter, Memento } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';

import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IWebviewPanelProvider,
    IWorkspaceService
} from '../../common/application/types';
import { UseCustomEditorApi } from '../../common/constants';
import { traceInfo } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';

import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposableRegistry,
    IMemento,
    InteractiveWindowMode,
    IPersistentStateFactory,
    Resource,
    WORKSPACE_MEMENTO
} from '../../common/types';
import { createDeferred } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { IServiceContainer } from '../../ioc/types';
import { Identifiers } from '../constants';
import { IDataViewerFactory } from '../data-viewing/types';
import { IExportDialog } from '../export/types';
import { KernelSelector } from '../jupyter/kernels/kernelSelector';
import {
    ICodeCssGenerator,
    IDataScienceErrorHandler,
    IInteractiveWindow,
    IInteractiveWindowListener,
    IInteractiveWindowLoadable,
    IInteractiveWindowProvider,
    IJupyterDebugger,
    IJupyterServerUriStorage,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    INotebookExporter,
    INotebookProvider,
    IStatusProvider,
    IThemeFinder
} from '../types';
import { InteractiveWindow } from './interactiveWindow';

// Export for testing
export const AskedForPerFileSettingKey = 'ds_asked_per_file_interactive';

@injectable()
export class InteractiveWindowProvider implements IInteractiveWindowProvider {
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

    private _windows: IInteractiveWindowLoadable[] = [];
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell
    ) {}

    public async getOrCreate(resource: Resource): Promise<IInteractiveWindow> {
        // Ask for a configuration change if appropriate
        const mode = await this.getInteractiveMode(resource);

        // See if we already have a match
        let result = this.get(resource, mode) as InteractiveWindow;
        if (!result) {
            // No match. Create a new item.
            result = this.create(resource, mode);

            // Wait for monaco ready (it's not really useable until it has a language)
            const readyPromise = createDeferred();
            const disposable = result.ready(() => readyPromise.resolve());

            // Wait for monaco ready
            await readyPromise.promise;
            disposable.dispose();
        }

        return result;
    }

    protected create(resource: Resource, mode: InteractiveWindowMode): InteractiveWindow {
        const title =
            mode === 'multiple' || (mode === 'perFile' && !resource)
                ? localize.DataScience.interactiveWindowTitleFormat().format(`#${this._windows.length + 1}`)
                : undefined;

        // Set it as soon as we create it. The .ctor for the interactive window
        // may cause a subclass to talk to the IInteractiveWindowProvider to get the active interactive window.
        const result = new InteractiveWindow(
            this.serviceContainer.getAll<IInteractiveWindowListener>(IInteractiveWindowListener),
            this.serviceContainer.get<IApplicationShell>(IApplicationShell),
            this.serviceContainer.get<IDocumentManager>(IDocumentManager),
            this.serviceContainer.get<IStatusProvider>(IStatusProvider),
            this.serviceContainer.get<IWebviewPanelProvider>(IWebviewPanelProvider),
            this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry),
            this.serviceContainer.get<ICodeCssGenerator>(ICodeCssGenerator),
            this.serviceContainer.get<IThemeFinder>(IThemeFinder),
            this.serviceContainer.get<IFileSystem>(IFileSystem),
            this.serviceContainer.get<IConfigurationService>(IConfigurationService),
            this.serviceContainer.get<ICommandManager>(ICommandManager),
            this.serviceContainer.get<INotebookExporter>(INotebookExporter),
            this.serviceContainer.get<IWorkspaceService>(IWorkspaceService),
            this.serviceContainer.get<IDataViewerFactory>(IDataViewerFactory),
            this.serviceContainer.get<IJupyterVariableDataProviderFactory>(IJupyterVariableDataProviderFactory),
            this.serviceContainer.get<IJupyterVariables>(IJupyterVariables, Identifiers.ALL_VARIABLES),
            this.serviceContainer.get<IJupyterDebugger>(IJupyterDebugger),
            this.serviceContainer.get<IDataScienceErrorHandler>(IDataScienceErrorHandler),
            this.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory),
            this.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO),
            this.serviceContainer.get<Memento>(IMemento, WORKSPACE_MEMENTO),
            this.serviceContainer.get<INotebookProvider>(INotebookProvider),
            this.serviceContainer.get<boolean>(UseCustomEditorApi),
            resource,
            mode,
            title,
            this.serviceContainer.get<KernelSelector>(KernelSelector),
            this.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker),
            this.serviceContainer.get<IJupyterServerUriStorage>(IJupyterServerUriStorage),
            this.serviceContainer.get<IExportDialog>(IExportDialog)
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
                void this.globalMemento.update(AskedForPerFileSettingKey, true);
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
