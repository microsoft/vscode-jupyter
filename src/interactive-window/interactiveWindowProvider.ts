// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable, named } from 'inversify';
import {
    ConfigurationTarget,
    Event,
    EventEmitter,
    Memento,
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
    IAsyncDisposable,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IMemento,
    InteractiveWindowMode,
    Resource,
    WORKSPACE_MEMENTO
} from '../platform/common/types';
import { chainable } from '../platform/common/utils/decorators';
import * as localize from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { IServiceContainer } from '../platform/ioc/types';
import { KernelConnectionMetadata } from '../kernels/types';
import { IEmbedNotebookEditorProvider, INotebookEditorProvider } from '../notebooks/types';
import { InteractiveWindow } from './interactiveWindow';
import { InteractiveWindowView, JVSC_EXTENSION_ID, NotebookCellScheme } from '../platform/common/constants';
import {
    IInteractiveWindow,
    IInteractiveWindowCache,
    IInteractiveWindowProvider,
    INativeInteractiveWindow,
    InteractiveTab
} from './types';
import { getInteractiveWindowTitle } from './identity';
import { createDeferred } from '../platform/common/utils/async';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import {
    IControllerDefaultService,
    IControllerRegistration,
    IVSCodeNotebookController
} from '../notebooks/controllers/types';
import { getResourceType } from '../platform/common/utils';
import { isInteractiveInputTab } from './helpers';

// Export for testing
export const AskedForPerFileSettingKey = 'ds_asked_per_file_interactive';
export const InteractiveWindowCacheKey = 'ds_interactive_window_cache';

/**
 * Factory for InteractiveWindow
 */
@injectable()
export class InteractiveWindowProvider
    implements IInteractiveWindowProvider, IEmbedNotebookEditorProvider, IAsyncDisposable
{
    public get onDidChangeActiveInteractiveWindow(): Event<IInteractiveWindow | undefined> {
        return this._onDidChangeActiveInteractiveWindow.event;
    }
    public get onDidCreateInteractiveWindow(): Event<IInteractiveWindow> {
        return this._onDidCreateInteractiveWindow.event;
    }
    public get activeWindow(): IInteractiveWindow | undefined {
        return this._windows.find(
            (win) =>
                window.activeNotebookEditor !== undefined &&
                win.notebookUri?.toString() === window.activeNotebookEditor?.notebook.uri.toString()
        );
    }
    public get windows(): ReadonlyArray<IInteractiveWindow> {
        return this._windows;
    }
    private readonly _onDidChangeActiveInteractiveWindow = new EventEmitter<IInteractiveWindow | undefined>();
    private readonly _onDidCreateInteractiveWindow = new EventEmitter<IInteractiveWindow>();
    private lastActiveInteractiveWindow: IInteractiveWindow | undefined;
    private pendingCreations: Promise<void>[] = [];
    private _windows: InteractiveWindow[] = [];

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private workspaceMemento: Memento,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IControllerDefaultService) private readonly controllerDefaultService: IControllerDefaultService,
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider
    ) {
        asyncRegistry.push(this);

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

            const result = new InteractiveWindow(
                this.serviceContainer,
                iw.owner !== undefined ? Uri.from(iw.owner) : undefined,
                iw.mode,
                undefined,
                interactiveWindowMapping.get(iw.uriString)!,
                Uri.parse(iw.inputBoxUriString)
            );
            this._windows.push(result);
        });

        this._updateWindowCache();
    }

    @chainable()
    public async getOrCreate(resource: Resource, connection?: KernelConnectionMetadata): Promise<IInteractiveWindow> {
        if (!this.workspaceService.isTrusted) {
            // This should not happen, but if it does, then just throw an error.
            // The commands the like should be disabled.
            throw new Error('Workspace not trusted');
        }
        // Ask for a configuration change if appropriate
        const mode = await this.getInteractiveMode(resource);

        // See if we already have a match
        if (this.pendingCreations.length) {
            // Possible its still in the process of getting created, hence wait on the creations to complete.
            // But ignore errors.
            const promises = Promise.all(this.pendingCreations.map((item) => item.catch(noop)));
            await promises.catch(noop);
        }
        let result = this.getExisting(resource, mode, connection) as IInteractiveWindow;
        if (!result) {
            // No match. Create a new item.
            result = await this.create(resource, mode, connection);
            // start the kernel
            result.start();
        } else {
            const preferredController = connection
                ? this.controllerRegistration.get(connection, InteractiveWindowView)
                : await this.controllerDefaultService.computeDefaultController(resource, InteractiveWindowView);

            await result.restore(preferredController);
        }

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

    public async dispose(): Promise<void> {
        return noop();
    }

    // Note to future devs: this function must be synchronous. Do not await on anything before calling
    // the interactive window ctor and adding the interactive window to the provider's list of known windows.
    // Otherwise we risk a race condition where e.g. multiple run cell requests come in quick and we end up
    // instantiating multiples.
    private async create(resource: Resource, mode: InteractiveWindowMode, connection?: KernelConnectionMetadata) {
        const creationInProgress = createDeferred<void>();
        // Ensure we don't end up calling this method multiple times when creating an IW for the same resource.
        this.pendingCreations.push(creationInProgress.promise);
        try {
            traceInfo(`Starting interactive window for resource '${getDisplayPath(resource)}'`);

            // Set it as soon as we create it. The .ctor for the interactive window
            // may cause a subclass to talk to the IInteractiveWindowProvider to get the active interactive window.
            // Find our preferred controller
            const preferredController = connection
                ? this.controllerRegistration.get(connection, InteractiveWindowView)
                : await this.controllerDefaultService.computeDefaultController(resource, InteractiveWindowView);

            const commandManager = this.serviceContainer.get<ICommandManager>(ICommandManager);
            const [inputUri, editor] = await this.createEditor(preferredController, resource, mode, commandManager);
            const result = new InteractiveWindow(
                this.serviceContainer,
                resource,
                mode,
                preferredController,
                editor,
                inputUri
            );
            this._windows.push(result);
            this._updateWindowCache();

            // This is the last interactive window at the moment (as we're about to create it)
            this.lastActiveInteractiveWindow = result;

            // When shutting down, we fire an event
            const handler = result.closed(this.onInteractiveWindowClosed.bind(this, result));
            this.disposables.push(result);
            this.disposables.push(handler);
            this.disposables.push(result.onDidChangeViewState(this.raiseOnDidChangeActiveInteractiveWindow.bind(this)));

            // fire created event
            this._onDidCreateInteractiveWindow.fire(result);
            return result;
        } finally {
            creationInProgress.resolve();
            this.pendingCreations = this.pendingCreations.filter((item) => item !== creationInProgress.promise);
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
        const { inputUri, notebookEditor } = (await commandManager.executeCommand(
            'interactive.open',
            // Keep focus on the owning file if there is one
            { viewColumn: ViewColumn.Beside, preserveFocus: hasOwningFile },
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
    private _updateWindowCache() {
        const windowCache = this._windows.map(
            (iw) =>
                ({
                    owner: iw.owner,
                    mode: iw.mode,
                    uriString: iw.notebookUri.toString(),
                    inputBoxUriString: iw.inputUri.toString()
                } as IInteractiveWindowCache)
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
        const targetInteractiveNotebookEditor =
            resource && getResourceType(resource) === 'interactive' ? this.get(resource)?.notebookEditor : undefined;
        const activeInteractiveNotebookEditor =
            getResourceType(resource) === 'interactive'
                ? this.getActiveOrAssociatedInteractiveWindow()?.notebookEditor
                : undefined;

        return targetInteractiveNotebookEditor || activeInteractiveNotebookEditor;
    }

    findAssociatedNotebookDocument(uri: Uri): NotebookDocument | undefined {
        const interactiveWindow = this.windows.find((w) => w.inputUri?.toString() === uri.toString());
        let notebook = interactiveWindow?.notebookDocument;
        return notebook;
    }
}
