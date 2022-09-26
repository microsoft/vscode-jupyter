// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as vscode from 'vscode';
import { INotebookMetadata } from '@jupyterlab/nbformat';
import { IKernel, KernelAction, KernelActionSource, KernelConnectionMetadata } from '../../kernels/types';
import { JupyterNotebookView, InteractiveWindowView } from '../../platform/common/constants';
import { IDisplayOptions, IDisposable, Resource } from '../../platform/common/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';

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
    /**
     * Connects to the kernel.
     * @param {(action: KernelAction, kernel: IKernel) => void} [onAction] Callback invoked once connected to the the kernel.
     * @param {(action: KernelAction, actionSource: KernelActionSource, kernel: IKernel) => Promise<void>} [onActionCompleted] Callback invoked once all necessary post processing has been completed (e.g. creating a live kernel connection after starting a kernel from a kernel spec).
     */
    connectToKernel(
        notebookResource: { resource?: vscode.Uri; notebook: vscode.NotebookDocument },
        options: IDisplayOptions,
        onAction?: (action: KernelAction, kernel: IKernel) => void,
        onActionCompleted?: (action: KernelAction, actionSource: KernelActionSource, kernel: IKernel) => Promise<void>
    ): Promise<IKernel>;
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
        option?: INotebookMetadata,
        preferredInterpreter?: PythonEnvironment,
        cancelToken?: vscode.CancellationToken,
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
     * Call this method to find all and create all of the controllers
     * @param {boolean} [refresh] Optionally forces a refresh of all local/remote kernels.
     */
    loadControllers(refresh?: boolean): Promise<void>;

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
