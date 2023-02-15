// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Disposable,
    Event,
    NotebookCell,
    NotebookController,
    NotebookDocument,
    NotebookEditor,
    Tab,
    Uri
} from 'vscode';
import { IDebuggingManager } from '../notebooks/debugger/debuggingTypes';
import { IKernel, KernelConnectionMetadata } from '../kernels/types';
import { Resource, InteractiveWindowMode, ICell } from '../platform/common/types';
import { IFileGeneratedCodes } from './editor-integration/types';
import { IServiceContainer } from '../platform/ioc/types';
import { IVSCodeNotebookController } from '../notebooks/controllers/types';

export type INativeInteractiveWindow = { notebookUri: Uri; inputUri: Uri; notebookEditor: NotebookEditor };

export const IInteractiveWindowDebugger = Symbol('IInteractiveWindowDebugger');
export interface IInteractiveWindowDebugger {
    attach(kernel: IKernel): Promise<void>;
    detach(kernel: IKernel): Promise<void>;
    enable(kernel: IKernel): void;
    disable(kernel: IKernel): void;
    updateSourceMaps(generatedCodes: IFileGeneratedCodes[]): Promise<void>;
}

export const IInteractiveWindowProvider = Symbol('IInteractiveWindowProvider');
export interface IInteractiveWindowProvider {
    /**
     * The active interactive window if it has the focus.
     */
    readonly activeWindow: IInteractiveWindow | undefined;
    /**
     * Event fired when the active interactive window changes
     */
    readonly onDidChangeActiveInteractiveWindow: Event<IInteractiveWindow | undefined>;
    /**
     * Gets or creates a new interactive window and associates it with the owner. If no owner, marks as a non associated.
     * @param {Resource} owner File that started this interactive window
     * @param {KernelConnectionMetadata} [connection] The kernel connection to be used when starting/connecting to the kernel.
     */
    getOrCreate(owner: Resource, connection?: KernelConnectionMetadata): Promise<IInteractiveWindow>;
    /**
     * Given a text document, return the associated interactive window if one exists.
     * @param owner The URI of a text document which may be associated with an interactive window.
     */
    get(owner: Uri): IInteractiveWindow | undefined;
    /**
     * The active interactive window if it has the focus, or the interactive window associated with current active text editor
     */
    getActiveOrAssociatedInteractiveWindow(): IInteractiveWindow | undefined;
    /**
     * Find an interactive window that contains the given notebook
     */
    getInteractiveWindowWithNotebook(notebookUri: Uri | undefined): IInteractiveWindow | undefined;
    /**
     * Find all interactive windows to which the file has submitted code
     */
    getInteractiveWindowsWithSubmitter(file: Uri): IInteractiveWindow[];
}

export const IInteractiveControllerHelper = Symbol('IInteractiveControllerHelper');
export interface IInteractiveControllerHelper {
    getInitialController(
        resource: Resource,
        connection?: KernelConnectionMetadata
    ): Promise<IVSCodeNotebookController | undefined>;
    getSelected(notebookDocument: NotebookDocument): IVSCodeNotebookController | undefined;
    createKernel(
        metadata: KernelConnectionMetadata,
        controller: NotebookController,
        resource: Resource,
        notebookDocument: NotebookDocument,
        disposables: Disposable[],
        serviceContainer: IServiceContainer
    ): Promise<{ kernel: IKernel; actualController: NotebookController }>;
}

export interface IInteractiveBase extends Disposable {
    hasCell(id: string): Promise<boolean>;
}

export interface IInteractiveWindow extends IInteractiveBase {
    readonly onDidChangeViewState: Event<void>;
    readonly owner: Resource;
    readonly submitters: Uri[];
    readonly notebookUri?: Uri;
    readonly inputUri?: Uri;
    readonly notebookDocument?: NotebookDocument;
    closed: Event<void>;
    ensureInitialized(): Promise<void>;
    addCode(code: string, file: Uri, line: number): Promise<boolean>;
    addErrorMessage(message: string, cell: NotebookCell): Promise<void>;
    debugCode(code: string, file: Uri, line: number): Promise<boolean>;
    expandAllCells(): Promise<void>;
    collapseAllCells(): Promise<void>;
    scrollToCell(id: string): void;
    exportAs(cells?: ICell[]): void;
    export(cells?: ICell[]): void;
    changeMode(newMode: InteractiveWindowMode): void;
}

export interface IInteractiveWindowCache {
    owner: Resource;
    mode: InteractiveWindowMode;
    uriString: string;
    inputBoxUriString: string;
}

export interface TabInputInteractiveWindow {
    readonly uri: Uri;
    readonly inputBoxUri: Uri;
}

export interface InteractiveTab extends Tab {
    readonly input: TabInputInteractiveWindow;
}

export const IInteractiveWindowDebuggingManager = Symbol('IInteractiveWindowDebuggingManager');
export interface IInteractiveWindowDebuggingManager extends IDebuggingManager {
    start(notebook: NotebookDocument, cell: NotebookCell): Promise<void>;
    updateSourceMaps(editor: NotebookEditor, generatedCodes: IFileGeneratedCodes[]): Promise<void>;
}
