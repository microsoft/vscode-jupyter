// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as vscode from 'vscode';
import { INotebookMetadata } from '@jupyterlab/nbformat';
import { KernelConnectionMetadata } from '../../kernels/types';
import { JupyterNotebookView, InteractiveWindowView } from '../../platform/common/constants';
import { IDisposable, Resource } from '../../platform/common/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { IContributedKernelFinderInfo } from '../../kernels/internalTypes';

export const InteractiveControllerIdSuffix = ' (Interactive)';

export interface IVSCodeNotebookController extends IDisposable {
    readonly connection: KernelConnectionMetadata;
    readonly controller: vscode.NotebookController;
    readonly id: string;
    readonly label: string;
    readonly viewType: typeof JupyterNotebookView | typeof InteractiveWindowView;
    readonly onNotebookControllerSelected: vscode.Event<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
    }>;
    readonly onNotebookControllerSelectionChanged: vscode.Event<{
        selected: boolean;
        notebook: vscode.NotebookDocument;
    }>;
    readonly onDidDispose: vscode.Event<void>;
    readonly onDidReceiveMessage: vscode.Event<{ editor: vscode.NotebookEditor; message: any }>;
    postMessage(message: any, editor?: vscode.NotebookEditor): Thenable<boolean>;
    asWebviewUri(localResource: vscode.Uri): vscode.Uri;
    isAssociatedWithDocument(notebook: vscode.NotebookDocument): boolean;
    updateConnection(connection: KernelConnectionMetadata): void;
    setPendingCellAddition(notebook: vscode.NotebookDocument, promise: Promise<void>): void;
}

export interface IVSCodeNotebookControllerUpdateEvent {
    added: IVSCodeNotebookController[];
    removed: IVSCodeNotebookController[];
}

export const IControllerRegistration = Symbol('IControllerRegistration');

export interface IControllerRegistration {
    /**
     * Gets the registered list of all of the controllers (the ones shown by VS code)
     */
    registered: IVSCodeNotebookController[];
    /**
     * Gets every registered connection metadata
     */
    all: KernelConnectionMetadata[];
    /**
     * Batch registers new controllers. Disposing a controller unregisters it.
     * @param a list of metadatas
     * @param types Types of notebooks to create the controller for
     */
    batchAdd(
        metadatas: KernelConnectionMetadata[],
        types: (typeof JupyterNotebookView | typeof InteractiveWindowView)[]
    ): IVSCodeNotebookController[];
    /**
     * Registers a new controller. Disposing a controller unregisters it.
     * @param metadata
     * @param types Types of notebooks to create the controller for
     */
    add(
        metadata: KernelConnectionMetadata,
        types: (typeof JupyterNotebookView | typeof InteractiveWindowView)[]
    ): IVSCodeNotebookController[];
    /**
     * Gets the controller for a particular connection
     * @param connection
     * @param notebookType
     */
    get(
        connection: KernelConnectionMetadata,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): IVSCodeNotebookController | undefined;
    /**
     * Event fired when a controller is created
     */
    onCreated: vscode.Event<IVSCodeNotebookController>;
    /**
     * Event fired when controllers are added or removed
     */
    onChanged: vscode.Event<IVSCodeNotebookControllerUpdateEvent>;
}

export const IControllerSelection = Symbol('IControllerSelection');

export interface IControllerSelection {
    readonly onControllerSelected: vscode.Event<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
    }>;
    readonly onControllerSelectionChanged: vscode.Event<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
        selected: boolean;
    }>;
    getSelected(document: vscode.NotebookDocument): IVSCodeNotebookController | undefined;
}
export const IControllerPreferredService = Symbol('IControllerPreferredService');

export interface IControllerPreferredService {
    /**
     * Given all of the registered controllers, finds the 'preferred' controller for a notebook
     * @param document
     * @param serverId
     */
    computePreferred(
        document: vscode.NotebookDocument,
        serverId?: string
    ): Promise<{ preferredConnection?: KernelConnectionMetadata; controller?: IVSCodeNotebookController }>;

    /**
     * Returns the preferred controller if already computed
     * @param notebook
     */
    getPreferred(notebook: vscode.NotebookDocument): IVSCodeNotebookController | undefined;
}

export const IKernelRankingHelper = Symbol('IKernelRankingHelper');
export interface IKernelRankingHelper {
    rankKernels(
        resource: Resource,
        kernels: KernelConnectionMetadata[],
        cancelToken: vscode.CancellationToken,
        option?: INotebookMetadata,
        preferredInterpreter?: PythonEnvironment,
        serverId?: string
    ): Promise<KernelConnectionMetadata[] | undefined>;

    // For the given kernel connection, return true if it's an exact match for the notebookMetadata
    isExactMatch(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        notebookMetadata: INotebookMetadata | undefined
    ): Promise<boolean>;
}

export const IControllerDefaultService = Symbol('IControllerDefaultService');
export interface IControllerDefaultService {
    /**
     * Creates the default controller for a notebook or interactive window
     * @param resource
     */
    computeDefaultController(
        resource: Resource,
        viewType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): Promise<IVSCodeNotebookController | undefined>;
}

export const IControllerLoader = Symbol('IControllerLoader');

export interface IControllerLoader {
    /**
     * Event fired when all of the controllers have been refreshed
     */
    readonly refreshed: vscode.Event<void>;

    /**
     * Promise resolved when controllers are done being loaded (refresh makes this promise update)
     */
    readonly loaded: Promise<void>;
}

// Flag enum for the reason why a kernel was logged as an exact match
export enum PreferredKernelExactMatchReason {
    NoMatch = 0,
    OnlyKernel = 1 << 0,
    WasPreferredInterpreter = 1 << 1,
    IsExactMatch = 1 << 2,
    IsNonPythonKernelLanguageMatch = 1 << 3
}

// Provides the UI to select a kernel source for a notebook document
export const INotebookKernelSourceSelector = Symbol('INotebookKernelSourceSelector');
export interface INotebookKernelSourceSelector {
    selectKernelSource(notebook: vscode.NotebookDocument): Promise<void>;
}

// Track what kernel source is selected for each open notebook document and persist that data
export const INotebookKernelSourceTracker = Symbol('INotebookKernelSourceTracker');
export interface INotebookKernelSourceTracker {
    getKernelSourceForNotebook(notebook: vscode.NotebookDocument): IContributedKernelFinderInfo | undefined;
    setKernelSourceForNotebook(notebook: vscode.NotebookDocument, kernelFinderInfo: IContributedKernelFinderInfo): void;
}
