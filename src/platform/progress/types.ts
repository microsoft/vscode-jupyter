// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

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
