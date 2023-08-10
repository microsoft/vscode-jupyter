// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import {
    ConfigurationTarget,
    Event,
    EventEmitter,
    Memento,
    NotebookControllerAffinity,
    NotebookDocument,
    NotebookEditor,
    Uri,
    ViewColumn,
    window
} from 'vscode';

import { IApplicationShell, ICommandManager, IWorkspaceService } from '../platform/common/application/types';
import { traceInfo, traceVerbose } from '../platform/logging';
import { IFileSystem } from '../platform/common/platform/types';

import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposableRegistry,
    IMemento,
    InteractiveWindowMode,
    Resource,
    WORKSPACE_MEMENTO
} from '../platform/common/types';
import * as localize from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { IServiceContainer } from '../platform/ioc/types';
import { KernelConnectionMetadata } from '../kernels/types';
import { IEmbedNotebookEditorProvider, INotebookEditorProvider } from '../notebooks/types';
import { InteractiveWindow } from './interactiveWindow';
import { JVSC_EXTENSION_ID, NotebookCellScheme, Telemetry } from '../platform/common/constants';
import {
    IInteractiveControllerHelper,
    IInteractiveWindow,
    IInteractiveWindowCache,
    IInteractiveWindowProvider,
    INativeInteractiveWindow,
    InteractiveTab
} from './types';
import { getInteractiveWindowTitle } from './identity';
import { createDeferred } from '../platform/common/utils/async';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IVSCodeNotebookController } from '../notebooks/controllers/types';
import { isInteractiveInputTab } from './helpers';
import { sendTelemetryEvent } from '../telemetry';
import { InteractiveControllerFactory } from './InteractiveWindowController';

// Export for testing
export const AskedForPerFileSettingKey = 'ds_asked_per_file_interactive';
export const InteractiveWindowCacheKey = 'ds_interactive_window_cache';

/**
 * Factory for InteractiveWindow
 */
@injectable()
export class InteractiveWindowProvider implements IInteractiveWindowProvider, IEmbedNotebookEditorProvider {
    public get onDidChangeActiveInteractiveWindow(): Event<IInteractiveWindow | undefined> {
        return this._onDidChangeActiveInteractiveWindow.event;
    }

    // returns the active Editor if it is an Interactive Window that we are tracking
    public get activeWindow(): IInteractiveWindow | undefined {
        const notebookUri = window.activeNotebookEditor?.notebook.uri.toString();
        return notebookUri ? this._windows.find((win) => win.notebookUri?.toString() === notebookUri) : undefined;
    }

    private readonly _onDidChangeActiveInteractiveWindow = new EventEmitter<IInteractiveWindow | undefined>();
    private lastActiveInteractiveWindow: IInteractiveWindow | undefined;
    private pendingCreations: Promise<void> | undefined;
    private _windows: InteractiveWindow[] = [];

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private workspaceMemento: Memento,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(IInteractiveControllerHelper) private readonly controllerHelper: IInteractiveControllerHelper
    ) {
        this.notebookEditorProvider.registerEmbedNotebookProvider(this);
        this.restoreWindows();
    }

    private restoreWindows() {
        // VS Code controls if interactive windows are restored.
        const interactiveWindowMapping = new Map<string, InteractiveTab>();
        window.tabGroups.all.forEach((group) => {
            group.tabs.forEach((tab) => {
                if (isInteractiveInputTab(tab) && tab.input.uri) {
                    interactiveWindowMapping.set(tab.input.uri.toString(), tab);
                }
            });
        });

        this.workspaceMemento.get(InteractiveWindowCacheKey, [] as IInteractiveWindowCache[]).forEach((iw) => {
            if (!iw.uriString || !interactiveWindowMapping.get(iw.uriString)) {
                return;
            }

            const tab = interactiveWindowMapping.get(iw.uriString);

            if (!tab) {
                return;
            }

            const mode = this.configService.getSettings(tab.input.uri).interactiveWindowMode;

            const result = new InteractiveWindow(
                this.serviceContainer,
                Uri.parse(iw.owner),
                new InteractiveControllerFactory(this.controllerHelper, mode),
                tab,
                Uri.parse(iw.inputBoxUriString)
            );
            result.notifyConnectionReset();

            this._windows.push(result);
            sendTelemetryEvent(
                Telemetry.CreateInteractiveWindow,
                { windowCount: this._windows.length },
                {
                    hasKernel: false,
                    hasOwner: !!iw.owner,
                    mode: mode,
                    restored: true
                }
            );

            const handler = result.closed(this.onInteractiveWindowClosed.bind(this, result));
            this.disposables.push(result);
            this.disposables.push(handler);
            this.disposables.push(result.onDidChangeViewState(this.raiseOnDidChangeActiveInteractiveWindow.bind(this)));
        });

        this._updateWindowCache();
    }

    public async getOrCreate(resource: Resource, connection?: KernelConnectionMetadata): Promise<IInteractiveWindow> {
        if (!this.workspaceService.isTrusted) {
            // This should not happen, but if it does, then just throw an error.
            // The commands the like should be disabled.
            throw new Error('Workspace not trusted');
        }
        // Ask for a configuration change if appropriate
        const mode = await this.getInteractiveMode(resource);

        // Ensure we wait for a previous creation to finish.
        if (this.pendingCreations) {
            await this.pendingCreations.catch(noop);
        }

        // See if we already have a match
        let result = this.getExisting(resource, mode, connection);
        if (!result) {
            // No match. Create a new item.
            result = await this.create(resource, mode, connection);
        }

        await result.ensureInitialized();

        return result;
    }

    /**
     * Given a text document, return the associated interactive window if one exists.
     * @param owner The URI of a text document which may be associated with an interactive window.
     */
    public get(owner: Uri): IInteractiveWindow | undefined {
        const mode = this.configService.getSettings(owner).interactiveWindowMode;
        return this.getExisting(owner, mode);
    }

    private async create(resource: Resource, mode: InteractiveWindowMode, connection?: KernelConnectionMetadata) {
        // track when a creation is pending, so consumers can wait before checking for an existing one.
        const creationInProgress = createDeferred<void>();
        // Ensure we don't end up calling this method multiple times when creating an IW for the same resource.
        this.pendingCreations = creationInProgress.promise;
        try {
            let initialController = await this.controllerHelper.getInitialController(resource, connection);

            traceInfo(
                `Starting interactive window for resource '${getDisplayPath(
                    resource
                )}' with controller '${initialController?.id}'`
            );

            const commandManager = this.serviceContainer.get<ICommandManager>(ICommandManager);
            const [inputUri, editor] = await this.createEditor(initialController, resource, mode, commandManager);
            if (initialController) {
                initialController.controller.updateNotebookAffinity(
                    editor.notebook,
                    NotebookControllerAffinity.Preferred
                );
            }
            traceVerbose(
                `Interactive Window Editor Created: ${editor.notebook.uri.toString()} with input box: ${inputUri.toString()}`
            );

            const result = new InteractiveWindow(
                this.serviceContainer,
                resource,
                new InteractiveControllerFactory(this.controllerHelper, mode, initialController),
                editor,
                inputUri
            );
            this._windows.push(result);
            sendTelemetryEvent(
                Telemetry.CreateInteractiveWindow,
                { windowCount: this._windows.length },
                {
                    hasKernel: !!initialController,
                    hasOwner: !!resource,
                    mode: mode,
                    restored: false
                }
            );
            this._updateWindowCache();

            // This is the last interactive window at the moment (as we're about to create it)
            this.lastActiveInteractiveWindow = result;

            // When shutting down, we fire an event
            const handler = result.closed(this.onInteractiveWindowClosed.bind(this, result));
            this.disposables.push(result);
            this.disposables.push(handler);
            this.disposables.push(result.onDidChangeViewState(this.raiseOnDidChangeActiveInteractiveWindow.bind(this)));

            return result;
        } finally {
            creationInProgress.resolve();
        }
    }
    private async createEditor(
        preferredController: IVSCodeNotebookController | undefined,
        resource: Resource,
        mode: InteractiveWindowMode,
        commandManager: ICommandManager
    ): Promise<[Uri, NotebookEditor]> {
        const controllerId = preferredController ? `${JVSC_EXTENSION_ID}/${preferredController.id}` : undefined;
        const hasOwningFile = resource !== undefined;
        let viewColumn = this.getInteractiveViewColumn(resource);
        const { inputUri, notebookEditor } = (await commandManager.executeCommand(
            'interactive.open',
            // Keep focus on the owning file if there is one
            { viewColumn: viewColumn, preserveFocus: hasOwningFile },
            undefined,
            controllerId,
            resource && mode === 'perFile' ? getInteractiveWindowTitle(resource) : undefined
        )) as unknown as INativeInteractiveWindow;
        if (!notebookEditor) {
            // This means VS Code failed to create an interactive window.
            // This should never happen.
            throw new Error('Failed to request creation of interactive window from VS Code.');
        }
        return [inputUri, notebookEditor];
    }

    private getInteractiveViewColumn(resource: Resource): ViewColumn {
        if (resource) {
            return ViewColumn.Beside;
        }

        const setting = this.configService.getSettings(resource).interactiveWindowViewColumn;
        if (setting === 'secondGroup') {
            return ViewColumn.One;
        } else if (setting === 'active') {
            return ViewColumn.Active;
        }

        return ViewColumn.Beside;
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
            (!this._windows[0].owner || !this.fs.arePathsSame(this._windows[0].owner, resource))
        ) {
            // See if the first window was tied to a file or not.
            this.globalMemento.update(AskedForPerFileSettingKey, true).then(noop, noop);
            const questions = [
                localize.DataScience.interactiveWindowModeBannerSwitchYes,
                localize.DataScience.interactiveWindowModeBannerSwitchNo
            ];
            // Ask user if they'd like to switch to per file or not.
            const response = await this.appShell.showInformationMessage(
                localize.DataScience.interactiveWindowModeBannerTitle,
                ...questions
            );
            if (response === questions[0]) {
                result = 'perFile';
                this._windows[0].changeMode(result);
                await this.configService.updateSetting(
                    'interactiveWindow.creationMode',
                    result,
                    resource,
                    ConfigurationTarget.Global
                );
            }
        }
        return result;
    }
    private _updateWindowCache() {
        const windowCache = this._windows.map(
            (iw) =>
                ({
                    owner: iw.owner?.toString(),
                    uriString: iw.notebookUri.toString(),
                    inputBoxUriString: iw.inputUri.toString()
                }) as IInteractiveWindowCache
        );
        this.workspaceMemento.update(InteractiveWindowCacheKey, windowCache).then(noop, noop);
    }

    public getExisting(
        owner: Resource,
        interactiveMode: InteractiveWindowMode,
        connection?: KernelConnectionMetadata
    ): IInteractiveWindow | undefined {
        // Single mode means there's only ever one.
        if (interactiveMode === 'single') {
            return this._windows.length > 0 ? this._windows[0] : undefined;
        }

        // Multiple means use last active window or create a new one
        // if not owned.
        if (interactiveMode === 'multiple') {
            // Owner being undefined means create a new window, otherwise use
            // the last active window.
            return owner ? this.activeWindow || this.lastActiveInteractiveWindow || this._windows[0] : undefined;
        }

        // Otherwise match the owner.
        return this._windows.find((w) => {
            if (!owner && !w.owner && !connection) {
                return true;
            }
            if (owner && w.owner && this.fs.arePathsSame(owner, w.owner)) {
                return !connection || w.kernelConnectionMetadata?.id === connection.id;
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

    private onInteractiveWindowClosed(interactiveWindow: IInteractiveWindow) {
        traceVerbose(`Closing interactive window: ${interactiveWindow.notebookUri?.toString()}`);
        interactiveWindow.dispose();
        this._windows = this._windows.filter((w) => w !== interactiveWindow);
        this._updateWindowCache();
        if (this.lastActiveInteractiveWindow === interactiveWindow) {
            this.lastActiveInteractiveWindow = this._windows[0];
        }
        this.raiseOnDidChangeActiveInteractiveWindow();
    }

    public getActiveOrAssociatedInteractiveWindow(): IInteractiveWindow | undefined {
        if (this.activeWindow) {
            return this.activeWindow;
        }
        if (window.activeTextEditor === undefined) {
            return;
        }
        const textDocumentUri = window.activeTextEditor.document.uri;
        if (textDocumentUri.scheme !== NotebookCellScheme) {
            return this.get(textDocumentUri);
        }
    }

    findNotebookEditor(resource: Resource): NotebookEditor | undefined {
        let notebook: NotebookDocument | undefined;
        if (resource && resource.path.endsWith('.interactive')) {
            notebook = this.get(resource)?.notebookDocument;
        } else {
            const mode = this.configService.getSettings(resource).interactiveWindowMode;
            notebook = this.getExisting(resource, mode)?.notebookDocument;
        }

        return notebook ? window.visibleNotebookEditors.find((editor) => editor.notebook === notebook) : undefined;
    }

    findAssociatedNotebookDocument(uri: Uri): NotebookDocument | undefined {
        const interactiveWindow = this._windows.find((w) => w.inputUri?.toString() === uri.toString());
        let notebook = interactiveWindow?.notebookDocument;
        return notebook;
    }

    getInteractiveWindowWithNotebook(notebookUri: Uri | undefined) {
        let targetInteractiveWindow;
        if (notebookUri !== undefined) {
            targetInteractiveWindow = this._windows.find((w) => w.notebookUri?.toString() === notebookUri.toString());
        } else {
            targetInteractiveWindow = this.getActiveOrAssociatedInteractiveWindow();
        }
        return targetInteractiveWindow;
    }

    getInteractiveWindowsWithSubmitter(file: Uri): IInteractiveWindow[] {
        return this._windows.filter((w) => w.submitters.find((s) => this.fs.arePathsSame(file, s)));
    }
}
