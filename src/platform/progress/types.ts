// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Disposable } from 'vscode';

export type Progress = { action: ReportableAction; phase: 'started' | 'completed' };
export interface IProgressReporter {
    report(progress: Progress): void;
}

/**
 * Actions performed by extension that can be (potentially) reported to the user.
 *
 * @export
 * @enum {number}
 */
export enum ReportableAction {
    /**
     * Getting kernels for a remote connection.
     * If not found, user may have to select.
     */
    KernelsGetKernelForRemoteConnection = 'KernelsGetKernelForRemoteConnection',
    /**
     * Registering kernel.
     */
    KernelsRegisterKernel = 'KernelsRegisterKernel',
    /**
     * Retrieving kernel specs.
     */
    KernelsGetKernelSpecs = 'KernelsGetKernelSpecs',
    /**
     * Starting Jupyter Notebook & waiting to get connection information.
     */
    NotebookStart = 'NotebookStart',
    /**
     * Connecting to the Jupyter Notebook.
     */
    NotebookConnect = 'NotebookConnect',
    /**
     * Wait for session to go idle.
     */
    JupyterSessionWaitForIdleSession = 'JupyterSessionWaitForIdleSession',
    InstallingMissingDependencies = 'InstallingMissingDependencies',
    ExportNotebookToPython = 'ExportNotebookToPython',
    PerformingExport = 'PerformingExport'
}

export const IStatusProvider = Symbol('IStatusProvider');
export interface IStatusProvider {
    // call this function to set the new status on the active
    // interactive window. Dispose of the returned object when done.
    set(message: string, timeout?: number, canceled?: () => void): Disposable;

    // call this function to wait for a promise while displaying status
    waitWithStatus<T>(promise: () => Promise<T>, message: string, timeout?: number, canceled?: () => void): Promise<T>;
}
