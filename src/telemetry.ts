// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import type { JSONObject } from '@lumino/coreutils';
// eslint-disable-next-line
import {
    JupyterCommands,
    NativeKeyboardCommandTelemetry,
    NativeMouseCommandTelemetry,
    Telemetry
} from './platform/common/constants';
import { CheckboxState, EventName, PlatformErrors, SliceOperationSource } from './platform/telemetry/constants';
import { DebuggingTelemetry } from './notebooks/debugger/constants';
import { EnvironmentType } from './platform/pythonEnvironments/info';
import { TelemetryErrorProperties, ErrorCategory } from './platform/errors/types';
import { ExportFormat } from './notebooks/export/types';
import {
    InterruptResult,
    KernelActionSource,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse
} from './kernels/types';
// eslint-disable-next-line
import { IExportedKernelService } from './standalone/api/extension';
import { SelectJupyterUriCommandSource } from './kernels/jupyter/serverSelector';
import { TerminalShellType } from './platform/terminals/types';
import { PreferredKernelExactMatchReason } from './notebooks/controllers/types';
import { KernelFailureReason } from './platform/errors/errorUtils';

export * from './platform/telemetry/index';

export type ResourceSpecificTelemetryProperties = Partial<{
    resourceType: 'notebook' | 'interactive';
    /**
     * Whether the user executed a cell.
     */
    userExecutedCell?: boolean;
    /**
     * Hash of the Kernel Connection id.
     */
    kernelId: string;
    /**
     * Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.
     * If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)
     */
    disableUI?: boolean;
    /**
     * Hash of the resource (notebook.uri or pythonfile.uri associated with this).
     * If we run the same notebook tomorrow, the hash will be the same.
     */
    resourceHash?: string;
    /**
     * Unique identifier for an instance of a notebook session.
     * If we restart or run this notebook tomorrow, this id will be different.
     * Id could be something as simple as a hash of the current Epoch time.
     */
    kernelSessionId: string;
    /**
     * Whether this resource is using the active Python interpreter or not.
     */
    isUsingActiveInterpreter?: boolean;
    /**
     * Found plenty of issues when starting kernels with conda, hence useful to capture this info.
     */
    pythonEnvironmentType?: EnvironmentType;
    /**
     * A key, so that rest of the information is tied to this. (hash)
     */
    pythonEnvironmentPath?: string;
    /**
     * Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)
     */
    pythonEnvironmentVersion?: string;
    /**
     * Total number of python environments.
     */
    pythonEnvironmentCount?: number;
    /**
     * Comma delimited list of hashed packages & their versions.
     */
    pythonEnvironmentPackages?: string;
    /**
     * Whether kernel was started using kernel spec, interpreter, etc.
     */
    kernelConnectionType?: KernelConnectionMetadata['kind'];
    /**
     * Language of the kernel connection.
     */
    kernelLanguage: string;
    /**
     * This number gets reset after we attempt a restart or change kernel.
     */
    interruptCount?: number;
    /**
     * This number gets reset after change the kernel.
     */
    restartCount?: number;
    /**
     * Number of times starting the kernel failed.
     */
    startFailureCount?: number;
    /**
     * Number of times the kernel was changed.
     */
    switchKernelCount?: number;
    /**
     * Total number of kernel specs in the kernel spec list.
     */
    kernelSpecCount: number;
    /**
     * Total number of interpreters in the kernel spec list.
     */
    kernelInterpreterCount: number;
    /**
     * Total number of live kernels in the kernel spec list.
     */
    kernelLiveCount: number;
    /**
     * Whether this was started by Jupyter extension or a 3rd party.
     */
    actionSource: KernelActionSource;
}>;

export interface IEventNamePropertyMapping {
    /**
     * Telemetry event sent with details just after editor loads
     */
    [EventName.EXTENSION_LOAD]: {
        /**
         * Number of workspace folders opened
         */
        workspaceFolderCount: number;
    };
    /**
     * Telemetry event sent when substituting Environment variables to calculate value of variables
     */
    [EventName.ENVFILE_VARIABLE_SUBSTITUTION]: never | undefined;
    /**
     * Telemetry event sent when an environment file is detected in the workspace.
     */
    [EventName.ENVFILE_WORKSPACE]: {
        /**
         * If there's a custom path specified in the python.envFile workspace settings.
         */
        hasCustomEnvPath: boolean;
    };
    /**
     * Telemetry event sent with details when tracking imports
     */
    [EventName.HASHED_PACKAGE_NAME]: {
        /**
         * Hash of the package name
         *
         * @type {string}
         */
        hashedNamev2: string;
    };
    [Telemetry.HashedCellOutputMimeTypePerf]: never | undefined;

    /**
     * Telemetry sent when we're unable to find a KernelSpec connection for Interactive window that can be started usig Python interpreter.
     */
    [Telemetry.FailedToFindKernelSpecInterpreterForInteractive]: never | undefined;
    /**
     * Telemetry sent for local Python Kernels.
     * Tracking whether we have managed to launch the kernel that matches the interpreter.
     * If match=false, then this means we have failed to launch the right kernel.
     */
    [Telemetry.PythonKerneExecutableMatches]: {
        match: 'true' | 'false';
        kernelConnectionType:
            | 'startUsingLocalKernelSpec'
            | 'startUsingPythonInterpreter'
            | 'startUsingRemoteKernelSpec';
    };
    /**
     * Sent when a jupyter session fails to start and we ask the user for a new kernel
     */
    [Telemetry.AskUserForNewJupyterKernel]: never | undefined;
    /**
     * Time taken to list the Python interpreters.
     */
    [Telemetry.InterpreterListingPerf]: {
        /**
         * Whether this is the first time in the session.
         * (fetching kernels first time in the session is slower, later its cached).
         * This is a generic property supported for all telemetry (sent by decorators).
         */
        firstTime?: boolean;
    };
    [Telemetry.ActiveInterpreterListingPerf]: {
        /**
         * Whether this is the first time in the session.
         * (fetching kernels first time in the session is slower, later its cached).
         * This is a generic property supported for all telemetry (sent by decorators).
         */
        firstTime?: boolean;
    };
    [Telemetry.KernelListingPerf]: {
        /**
         * Whether this is the first time in the session.
         * (fetching kernels first time in the session is slower, later its cached).
         * This is a generic property supported for all telemetry (sent by decorators).
         */
        firstTime?: boolean;
        /**
         * Whether this telemetry is for listing of all kernels or just python or just non-python.
         * (fetching kernels first time in the session is slower, later its cached).
         */
        kind: 'remote' | 'local' | 'localKernelSpec' | 'localPython';
    };
    [Telemetry.NumberOfLocalKernelSpecs]: {
        /**
         * Number of kernel specs.
         */
        count: number;
    };
    [Telemetry.NumberOfRemoteKernelSpecs]: {
        /**
         * Number of kernel specs.
         */
        count: number;
    };
    [Telemetry.HashedNotebookCellOutputMimeTypePerf]: never | undefined;
    [Telemetry.HashedCellOutputMimeType]: {
        /**
         * Hash of the cell output mimetype
         *
         * @type {string}
         */
        hashedName: string;
        hasText: boolean;
        hasLatex: boolean;
        hasHtml: boolean;
        hasSvg: boolean;
        hasXml: boolean;
        hasJson: boolean;
        hasImage: boolean;
        hasGeo: boolean;
        hasPlotly: boolean;
        hasVega: boolean;
        hasWidget: boolean;
        hasJupyter: boolean;
        hasVnd: boolean;
    };

    /**
     * Used to capture time taken to get enviornment variables for a python environment.
     * Also lets us know whether it worked or not.
     */
    [Telemetry.GetActivatedEnvironmentVariables]: {
        /**
         * Type of the Python environment.
         */
        envType?: EnvironmentType;
        /**
         * Duplicate of `envType`, the property `envType` doesn't seem to be coming through.
         * If we can get `envType`, then we'll deprecate this new property.
         * Else we just deprecate & remote the old property.
         */
        pythonEnvType?: EnvironmentType;
        /**
         * Whether the env variables were fetched successfully or not.
         */
        failed: boolean;
        /**
         * Source where the env variables were fetched from.
         * If `python`, then env variables were fetched from Python extension.
         * If `jupyter`, then env variables were fetched from Jupyter extension.
         */
        source: 'python' | 'jupyter';
        /**
         * Reason for not being able to get the env variables.
         */
        reason?:
            | 'noActivationCommands'
            | 'unknownOS'
            | 'emptyVariables'
            | 'unhandledError'
            | 'emptyFromCondaRun'
            | 'emptyFromPython'
            | 'failedToGetActivatedEnvVariablesFromPython'
            | 'failedToGetCustomEnvVariables';
    };
    [EventName.HASHED_PACKAGE_PERF]: never | undefined;
    /**
     * Telemetry event sent after fetching the OS version
     */
    [EventName.PLATFORM_INFO]: {
        /**
         * If fetching OS version fails, list the failure type
         *
         * @type {PlatformErrors}
         */
        failureType?: PlatformErrors;
        /**
         * The OS version of the platform
         *
         * @type {string}
         */
        osVersion?: string;
    };
    [EventName.PYTHON_INTERPRETER_ACTIVATION_ENVIRONMENT_VARIABLES]: {
        /**
         * Carries `true` if environment variables are present, `false` otherwise
         *
         * @type {boolean}
         */
        hasEnvVars?: boolean;
        /**
         * Carries `true` if fetching environment variables failed, `false` otherwise
         *
         * @type {boolean}
         */
        failed?: boolean;
        /**
         * Whether the environment was activated within a terminal or not.
         *
         * @type {boolean}
         */
        activatedInTerminal?: boolean;
        /**
         * Whether the environment was activated by the wrapper class.
         * If `true`, this telemetry is sent by the class that wraps the two activation providers   .
         *
         * @type {boolean}
         */
        activatedByWrapper?: boolean;
    };
    /**
     * Telemetry event sent with details when a user has requested to opt it or out of an experiment group
     */
    [EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT]: {
        /**
         * Carries the name of the experiment user has been opted into manually
         */
        expNameOptedInto?: string;
        /**
         * Carries the name of the experiment user has been opted out of manually
         */
        expNameOptedOutOf?: string;
    };
    /**
     * Telemetry event sent when user opens the data viewer.
     */
    [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST]: never | undefined;
    [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR]: never | undefined;
    [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS]: never | undefined;
    /**
     * Telemetry event sent when user adds a cell below the current cell for IW.
     */
    [Telemetry.AddCellBelow]: never | undefined;
    [Telemetry.CodeLensAverageAcquisitionTime]: never | undefined;
    [Telemetry.CollapseAll]: never | undefined;
    [Telemetry.ConnectFailedJupyter]: TelemetryErrorProperties;
    [Telemetry.ConnectLocalJupyter]: never | undefined;
    [Telemetry.ConnectRemoteJupyter]: never | undefined;
    /**
     * Connecting to an existing Jupyter server, but connecting to localhost.
     */
    [Telemetry.ConnectRemoteJupyterViaLocalHost]: never | undefined;
    [Telemetry.ConnectRemoteFailedJupyter]: TelemetryErrorProperties;
    /**
     * Jupyter server's certificate is not from a trusted authority.
     */
    [Telemetry.ConnectRemoteSelfCertFailedJupyter]: never | undefined;
    /**
     * Jupyter server's certificate has expired.
     */
    [Telemetry.ConnectRemoteExpiredCertFailedJupyter]: never | undefined;
    [Telemetry.RegisterAndUseInterpreterAsKernel]: never | undefined;
    [Telemetry.UseInterpreterAsKernel]: never | undefined;
    [Telemetry.UseExistingKernel]: never | undefined;
    [Telemetry.SwitchToExistingKernel]: { language: string };
    [Telemetry.SwitchToInterpreterAsKernel]: never | undefined;
    [Telemetry.ConvertToPythonFile]: never | undefined;
    [Telemetry.CopySourceCode]: never | undefined;
    [Telemetry.CreateNewNotebook]: never | undefined;
    [Telemetry.DataScienceSettings]: JSONObject;
    /**
     * Telemetry event sent when user hits the `continue` button while debugging IW
     */
    [Telemetry.DebugContinue]: never | undefined;
    /**
     * Telemetry event sent when user debugs the cell in the IW
     */
    [Telemetry.DebugCurrentCell]: never | undefined;
    /**
     * Telemetry event sent when user hits the `step over` button while debugging IW
     */
    [Telemetry.DebugStepOver]: never | undefined;
    /**
     * Telemetry event sent when user hits the `stop` button while debugging IW
     */
    [Telemetry.DebugStop]: never | undefined;
    /**
     * Telemetry event sent when user debugs the file in the IW
     */
    [Telemetry.DebugFileInteractive]: never | undefined;
    [Telemetry.DeleteAllCells]: never | undefined;
    [Telemetry.DeleteCell]: never | undefined;
    [Telemetry.FindJupyterCommand]: { command: string };
    [Telemetry.FindJupyterKernelSpec]: never | undefined;
    [Telemetry.FailedToUpdateKernelSpec]: never | undefined;
    /**
     * Disables using Shift+Enter to run code in IW (this is in response to the prompt recommending users to enable this to use the IW)
     */
    [Telemetry.DisableInteractiveShiftEnter]: never | undefined;
    /**
     * Disables using Shift+Enter to run code in IW (this is in response to the prompt recommending users to enable this to use the IW)
     */
    [Telemetry.EnableInteractiveShiftEnter]: never | undefined;
    [Telemetry.ExecuteCellTime]: never | undefined;
    /**
     * Telemetry sent to capture first time execution of a cell.
     * If `notebook = true`, this its telemetry for Jupyter notebooks, else applies to IW.
     */
    [Telemetry.ExecuteCellPerceivedCold]: undefined | { notebook: boolean };
    /**
     * Telemetry sent to capture subsequent execution of a cell.
     * If `notebook = true`, this its telemetry for native editor/notebooks.
     * (Note: The property `notebook` only gets sent correctly in Jupyter version 2022.8.0 or later)
     */
    [Telemetry.ExecuteCellPerceivedWarm]: undefined | { notebook: boolean };
    /**
     * Time take for jupyter server to start and be ready to run first user cell.
     * (Note: The property `notebook` only gets sent correctly in Jupyter version 2022.8.0 or later)
     */
    [Telemetry.PerceivedJupyterStartupNotebook]: ResourceSpecificTelemetryProperties;
    /**
     * Time take for jupyter server to be busy from the time user first hit `run` cell until jupyter reports it is busy running a cell.
     */
    [Telemetry.StartExecuteNotebookCellPerceivedCold]: ResourceSpecificTelemetryProperties;
    [Telemetry.ExpandAll]: never | undefined;
    [Telemetry.ExportNotebookInteractive]: never | undefined;
    /**
     * User exports a .py file with cells as a Jupyter Notebook.
     */
    [Telemetry.ExportPythonFileInteractive]: never | undefined;
    /**
     * User exports a .py file with cells along with the outputs from the current IW as a Jupyter Notebook.
     */
    [Telemetry.ExportPythonFileAndOutputInteractive]: never | undefined;
    /**
     * User exports the IW or Notebook to a specific format.
     */
    [Telemetry.ClickedExportNotebookAsQuickPick]: { format: ExportFormat };
    /**
     * Called when user imports a Jupyter Notebook into a Python file.
     * Command is `Jupyter: Import Jupyter Notebook`
     * Basically user is exporting some jupyter notebook into a Python file or other.
     */
    [Telemetry.ExportNotebookAs]: { format: ExportFormat; cancelled?: boolean; successful?: boolean; opened?: boolean };
    /**
     * Called when user imports a Jupyter Notebook into a Python file.
     * Command is `Jupyter: Import Jupyter Notebook`
     * Basically user is exporting some jupyter notebook into a Python file.
     */
    [Telemetry.ImportNotebook]: { scope: 'command' | 'file' };
    /**
     * Called when user exports a Jupyter Notebook or IW into a Python file, HTML, PDF, etc.
     * Command is `Jupyter: Export to Python Script` or `Jupyter: Export to HTML`
     * Basically user is exporting some jupyter notebook or IW into a Python file or other.
     */
    [Telemetry.ExportNotebookAsCommand]: { format: ExportFormat };
    /**
     * Export fails
     */
    [Telemetry.ExportNotebookAsFailed]: { format: ExportFormat };
    [Telemetry.GetPasswordAttempt]: never | undefined;
    [Telemetry.GetPasswordFailure]: never | undefined;
    [Telemetry.GetPasswordSuccess]: never | undefined;
    [Telemetry.GotoSourceCode]: never | undefined;
    [Telemetry.HiddenCellTime]: never | undefined;
    [Telemetry.ImportNotebook]: { scope: 'command' | 'file' };
    /**
     * User interrupts a cell
     * Identical to `Telemetry.InterruptJupyterTime`
     */
    [Telemetry.Interrupt]: never | undefined;
    /**
     * User interrupts a cell
     * Identical to `Telemetry.Interrupt`
     */
    [Telemetry.InterruptJupyterTime]: never | undefined;
    /**
     * Total number of cells executed. Telemetry Sent when VS Code is closed.
     */
    [Telemetry.NotebookRunCount]: { count: number };
    /**
     * Total number of Jupyter notebooks or IW opened. Telemetry Sent when VS Code is closed.
     */
    [Telemetry.NotebookOpenCount]: { count: number };
    [Telemetry.NotebookOpenTime]: number;
    [Telemetry.PandasNotInstalled]: never | undefined;
    [Telemetry.PandasTooOld]: never | undefined;
    [Telemetry.PandasOK]: never | undefined;
    [Telemetry.PandasInstallCanceled]: { version: string };
    [Telemetry.DebugpyInstallCancelled]: never | undefined;
    [Telemetry.DebugpyInstallFailed]: never | undefined;
    [Telemetry.DebugpyPromptToInstall]: never | undefined;
    [Telemetry.DebugpySuccessfullyInstalled]: never | undefined;
    [Telemetry.OpenNotebook]: { scope: 'command' | 'file' };
    [Telemetry.OpenNotebookAll]: never | undefined;
    /**
     * Telemetry sent with details of the selection of the quick pick for when user creates new notebook.
     * This only applies with other extensions like .NET registers with us.
     */
    [Telemetry.OpenNotebookSelection]: {
        /**
         * The id of the extension selected from the dropdown list.
         * If empty, the user didn't select anything & didn't create a new notebook.
         */
        extensionId?: string;
    };
    [Telemetry.OpenNotebookSelectionRegistered]: {
        /**
         * The id of the extension registering with us to be displayed the dropdown list for notebook creation.
         */
        extensionId: string;
    };
    [Telemetry.OpenedInteractiveWindow]: never | undefined;
    [Telemetry.OpenPlotViewer]: never | undefined;
    [Telemetry.Redo]: never | undefined;
    /**
     * Total time taken to restart a kernel.
     * Identical to `Telemetry.RestartKernel`
     */
    [Telemetry.RestartJupyterTime]: never | undefined;
    /**
     * Total time taken to restart a kernel.
     * Identical to `Telemetry.RestartJupyterTime`
     */
    [Telemetry.RestartKernel]: never | undefined;
    /**
     * Telemetry event sent when IW or Notebook is restarted.
     */
    [Telemetry.RestartKernelCommand]: never | undefined;
    /**
     * Run all Cell Commands in Interactive Python
     */
    [Telemetry.RunAllCells]: never | undefined;
    /**
     * Run a Selection or Line in Interactive Python
     */
    [Telemetry.RunSelectionOrLine]: never | undefined;
    /**
     * Run a Cell in Interactive Python
     */
    [Telemetry.RunCell]: never | undefined;
    /**
     * Run the current Cell in Interactive Python
     */
    [Telemetry.RunCurrentCell]: never | undefined;
    /**
     * Run all the above cells in Interactive Python
     */
    [Telemetry.RunAllCellsAbove]: never | undefined;
    /**
     * Run current cell and all below in Interactive Python
     */
    [Telemetry.RunCellAndAllBelow]: never | undefined;
    /**
     * Run current cell and advance cursor in Interactive Python
     */
    [Telemetry.RunCurrentCellAndAdvance]: never | undefined;
    /**
     * Run file in Interactive Python
     */
    [Telemetry.RunFileInteractive]: never | undefined;
    [Telemetry.RunToLine]: never | undefined;
    [Telemetry.RunFromLine]: never | undefined;
    [Telemetry.ScrolledToCell]: never | undefined;
    /**
     * Cell Edit Commands in Interactive Python
     */
    [Telemetry.InsertCellBelowPosition]: never | undefined;
    [Telemetry.InsertCellBelow]: never | undefined;
    [Telemetry.InsertCellAbove]: never | undefined;
    [Telemetry.DeleteCells]: never | undefined;
    [Telemetry.SelectCell]: never | undefined;
    [Telemetry.SelectCellContents]: never | undefined;
    [Telemetry.ExtendSelectionByCellAbove]: never | undefined;
    [Telemetry.ExtendSelectionByCellBelow]: never | undefined;
    [Telemetry.MoveCellsUp]: never | undefined;
    [Telemetry.MoveCellsDown]: never | undefined;
    [Telemetry.ChangeCellToMarkdown]: never | undefined;
    [Telemetry.ChangeCellToCode]: never | undefined;
    [Telemetry.GotoNextCellInFile]: never | undefined;
    [Telemetry.GotoPrevCellInFile]: never | undefined;
    /**
     * Misc
     */
    [Telemetry.AddEmptyCellToBottom]: never | undefined;
    [Telemetry.RunCurrentCellAndAddBelow]: never | undefined;
    [Telemetry.CellCount]: { count: number };
    [Telemetry.Save]: never | undefined;
    [Telemetry.SelfCertsMessageClose]: never | undefined;
    [Telemetry.SelfCertsMessageEnabled]: never | undefined;
    [Telemetry.SelectJupyterURI]: never | undefined;
    /**
     * Captures the telemetry when the Uri is manually entered by the user as part of the workflow when selecting a Kernel.
     */
    [Telemetry.EnterJupyterURI]: never | undefined;
    [Telemetry.SelectLocalJupyterKernel]: never | undefined;
    [Telemetry.SelectRemoteJupyterKernel]: never | undefined;
    [Telemetry.SessionIdleTimeout]: never | undefined;
    [Telemetry.JupyterNotInstalledErrorShown]: never | undefined;
    [Telemetry.JupyterCommandSearch]: {
        where: 'activeInterpreter' | 'otherInterpreter' | 'path' | 'nowhere';
        command: JupyterCommands;
    };
    [Telemetry.UserInstalledJupyter]: never | undefined;
    [Telemetry.UserInstalledPandas]: never | undefined;
    [Telemetry.UserDidNotInstallJupyter]: never | undefined;
    [Telemetry.UserDidNotInstallPandas]: never | undefined;
    [Telemetry.FailedToInstallPandas]: never | undefined;
    [Telemetry.PythonNotInstalled]: {
        action:
            | 'displayed' // Message displayed.
            | 'dismissed' // user dismissed the message.
            | 'download'; // User chose click the download link.
    };
    [Telemetry.PythonExtensionNotInstalled]: {
        action:
            | 'displayed' // Message displayed.
            | 'dismissed' // user dismissed the message.
            | 'download'; // User chose click the download link.
    };
    [Telemetry.PythonExtensionInstalledViaKernelPicker]: {
        action:
            | 'success' // Correctly installed and hooked the API
            | 'failed'; // Failed to install correctly
    };
    [Telemetry.KernelNotInstalled]: {
        action: 'displayed'; // Message displayed.
        /**
         * Language found in the notebook if a known language. Otherwise 'unknown'
         */
        language: string;
    };
    [Telemetry.PythonModuleInstall]: {
        moduleName: string;
        /**
         * Whether the module was already (once before) installed into the python environment or
         * whether this already exists (detected via `pip list`)
         */
        isModulePresent?: 'true' | undefined;
        action:
            | 'cancelled' // User cancelled the installation or closed the notebook or the like.
            | 'displayed' // Install prompt may have been displayed.
            | 'prompted' // Install prompt was displayed.
            | 'installed' // Installation disabled (this is what python extension returns).
            | 'ignored' // Installation disabled (this is what python extension returns).
            | 'disabled' // Installation disabled (this is what python extension returns).
            | 'failed' // Installation disabled (this is what python extension returns).
            | 'install' // User chose install from prompt.
            | 'donotinstall' // User chose not to install from prompt.
            | 'differentKernel' // User chose to select a different kernel.
            | 'error' // Some other error.
            | 'installedInJupyter' // The package was successfully installed in Jupyter whilst failed to install in Python ext.
            | 'failedToInstallInJupyter' // Failed to install the package in Jupyter as well as Python ext.
            | 'dismissed' // User chose to dismiss the prompt.
            | 'moreInfo'; // User requested more information on the module in question
        resourceType?: 'notebook' | 'interactive';
        /**
         * Hash of the resource (notebook.uri or pythonfile.uri associated with this).
         * If we run the same notebook tomorrow, the hash will be the same.
         */
        resourceHash?: string;
        pythonEnvType?: EnvironmentType;
    };
    /**
     * This telemetry tracks the display of the Picker for Jupyter Remote servers.
     */
    [Telemetry.SetJupyterURIUIDisplayed]: {
        /**
         * This telemetry tracks the source of this UI.
         * nonUser - Invoked internally by our code.
         * toolbar - Invoked by user from Native or Interactive window toolbar.
         * commandPalette - Invoked from command palette by the user.
         * nativeNotebookStatusBar - Invoked from Native notebook statusbar.
         * nativeNotebookToolbar - Invoked from Native notebook toolbar.
         */
        commandSource: SelectJupyterUriCommandSource;
    };
    [Telemetry.SetJupyterURIToLocal]: never | undefined;
    [Telemetry.SetJupyterURIToUserSpecified]: {
        azure: boolean;
    };
    [Telemetry.ShiftEnterBannerShown]: never | undefined;
    [Telemetry.StartShowDataViewer]: never | undefined;
    [Telemetry.ShowDataViewer]: { rows: number | undefined; columns: number | undefined };
    [Telemetry.FailedShowDataViewer]: never | undefined;
    /**
     * Sent when the jupyter.refreshDataViewer command is invoked
     */
    [Telemetry.RefreshDataViewer]: never | undefined;
    [Telemetry.CreateNewInteractive]: never | undefined;
    [Telemetry.StartJupyter]: never | undefined;
    [Telemetry.StartJupyterProcess]: never | undefined;
    /**
     * Telemetry event sent when jupyter has been found in interpreter but we cannot find kernelspec.
     *
     * @type {(never | undefined)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.JupyterInstalledButNotKernelSpecModule]: never | undefined;
    [Telemetry.JupyterStartTimeout]: {
        /**
         * Total time spent in attempting to start and connect to jupyter before giving up.
         *
         * @type {number}
         */
        timeout: number;
    };
    [Telemetry.SubmitCellThroughInput]: never | undefined;
    [Telemetry.Undo]: never | undefined;
    [Telemetry.VariableExplorerFetchTime]: never | undefined;
    [Telemetry.VariableExplorerToggled]: { open: boolean; runByLine: boolean };
    [Telemetry.VariableExplorerVariableCount]: { variableCount: number };
    [Telemetry.WaitForIdleJupyter]: never | undefined;
    [Telemetry.WebviewStartup]: { type: string };
    [Telemetry.WebviewStyleUpdate]: never | undefined;
    [Telemetry.RegisterInterpreterAsKernel]: never | undefined;
    /**
     * Telemetry sent when user selects an interpreter to start jupyter server.
     *
     * @type {(never | undefined)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.SelectJupyterInterpreterCommand]: never | undefined;
    [Telemetry.SelectJupyterInterpreter]: {
        /**
         * The result of the selection.
         * notSelected - No interpreter was selected.
         * selected - An interpreter was selected (and configured to have jupyter and notebook).
         * installationCancelled - Installation of jupyter and/or notebook was cancelled for an interpreter.
         *
         * @type {('notSelected' | 'selected' | 'installationCancelled')}
         */
        result?: 'notSelected' | 'selected' | 'installationCancelled';
    };
    [Telemetry.SelectJupyterInterpreterMessageDisplayed]: undefined | never;
    [NativeKeyboardCommandTelemetry.ArrowDown]: never | undefined;
    [NativeKeyboardCommandTelemetry.ArrowUp]: never | undefined;
    [NativeKeyboardCommandTelemetry.ChangeToCode]: never | undefined;
    [NativeKeyboardCommandTelemetry.ChangeToMarkdown]: never | undefined;
    [NativeKeyboardCommandTelemetry.DeleteCell]: never | undefined;
    [NativeKeyboardCommandTelemetry.InsertAbove]: never | undefined;
    [NativeKeyboardCommandTelemetry.InsertBelow]: never | undefined;
    [NativeKeyboardCommandTelemetry.Redo]: never | undefined;
    [NativeKeyboardCommandTelemetry.Run]: never | undefined;
    [NativeKeyboardCommandTelemetry.RunAndAdd]: never | undefined;
    [NativeKeyboardCommandTelemetry.RunAndMove]: never | undefined;
    [NativeKeyboardCommandTelemetry.Save]: never | undefined;
    [NativeKeyboardCommandTelemetry.ToggleLineNumbers]: never | undefined;
    [NativeKeyboardCommandTelemetry.ToggleOutput]: never | undefined;
    [NativeKeyboardCommandTelemetry.Undo]: never | undefined;
    [NativeKeyboardCommandTelemetry.Unfocus]: never | undefined;
    [NativeMouseCommandTelemetry.AddToEnd]: never | undefined;
    [NativeMouseCommandTelemetry.ChangeToCode]: never | undefined;
    [NativeMouseCommandTelemetry.ChangeToMarkdown]: never | undefined;
    [NativeMouseCommandTelemetry.DeleteCell]: never | undefined;
    [NativeMouseCommandTelemetry.InsertBelow]: never | undefined;
    [NativeMouseCommandTelemetry.MoveCellDown]: never | undefined;
    [NativeMouseCommandTelemetry.MoveCellUp]: never | undefined;
    [NativeMouseCommandTelemetry.Run]: never | undefined;
    [NativeMouseCommandTelemetry.RunAbove]: never | undefined;
    [NativeMouseCommandTelemetry.RunAll]: never | undefined;
    [NativeMouseCommandTelemetry.RunBelow]: never | undefined;
    [NativeMouseCommandTelemetry.Save]: never | undefined;
    [NativeMouseCommandTelemetry.SelectKernel]: never | undefined;
    [NativeMouseCommandTelemetry.SelectServer]: never | undefined;
    [NativeMouseCommandTelemetry.ToggleVariableExplorer]: never | undefined;
    /**
     * Telemetry event sent once done searching for kernel spec and interpreter for a local connection.
     *
     * @type {{
     *         kernelSpecFound: boolean;
     *         interpreterFound: boolean;
     *     }}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.FindKernelForLocalConnection]: {
        /**
         * Whether a kernel spec was found.
         *
         * @type {boolean}
         */
        kernelSpecFound: boolean;
        /**
         * Whether an interpreter was found.
         *
         * @type {boolean}
         */
        interpreterFound: boolean;
        /**
         * Whether user was prompted to select a kernel spec.
         *
         * @type {boolean}
         */
        promptedToSelect?: boolean;
    };
    /**
     * Telemetry event sent when starting a session for a local connection failed.
     *
     * @type {(undefined | never)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.StartSessionFailedJupyter]: undefined | never;
    /**
     * Telemetry event fired if a failure occurs loading a notebook
     */
    [Telemetry.OpenNotebookFailure]: undefined | never;
    /**
     * Telemetry event sent to capture total time taken for completions list to be provided by LS.
     * This is used to compare against time taken by Jupyter.
     *
     * @type {(undefined | never)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.CompletionTimeFromLS]: undefined | never;
    /**
     * Telemetry event sent to capture total time taken for completions list to be provided by Jupyter.
     * This is used to compare against time taken by LS.
     *
     * @type {(undefined | never)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.CompletionTimeFromJupyter]: undefined | never;
    /**
     * Telemetry event sent to indicate the language used in a notebook
     *
     * @type { language: string }
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.NotebookLanguage]: {
        /**
         * Language found in the notebook if a known language. Otherwise 'unknown'
         */
        language: string;
    };
    [Telemetry.KernelSpecLanguage]: {
        /**
         * Language of the kernelSpec.
         */
        language: string;
        /**
         * Whether this is a local or remote kernel.
         */
        kind: 'local' | 'remote';
        /**
         * Whether shell is used to start the kernel. E.g. `"/bin/sh"` is used in the argv of the kernelSpec.
         * OCaml is one such kernel.
         */
        usesShell?: boolean;
    };
    /**
     * Telemetry event sent to indicate 'jupyter kernelspec' is not possible.
     *
     * @type {(undefined | never)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.KernelSpecNotFound]: undefined | never;
    /**
     * Telemetry event sent to indicate registering a kernel with jupyter failed.
     *
     * @type {(undefined | never)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.KernelRegisterFailed]: undefined | never;
    /**
     * Telemetry event sent to every time a kernel enumeration is done
     *
     * @type {...}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.KernelEnumeration]: {
        /**
         * Count of the number of kernels found
         */
        count: number;
        /**
         * Boolean indicating if any are python or not
         */
        isPython: boolean;
        /**
         * Indicates how the enumeration was acquired.
         */
        source: 'cli' | 'connection';
    };
    /**
     * Total time taken to Launch a raw kernel.
     */
    [Telemetry.KernelLauncherPerf]: undefined | never | TelemetryErrorProperties;
    /**
     * Total time taken to find a kernel on disc or on a remote machine.
     */
    [Telemetry.RankKernelsPerf]: never | undefined;
    /**
     * Total time taken to list kernels for VS Code.
     */
    [Telemetry.KernelProviderPerf]: undefined | never;
    /**
     * Total time taken to get the preferred kernel for notebook.
     */
    [Telemetry.GetPreferredKernelPerf]: undefined | never;
    /**
     * Telemetry sent when we have attempted to find the preferred kernel.
     */
    [Telemetry.PreferredKernel]: {
        result: 'found' | 'notfound' | 'failed'; // Whether a preferred kernel was found or not.
        language: string; // Language of the associated notebook or interactive window.
        resourceType: 'notebook' | 'interactive'; // Whether its a notebook or interactive window.
        hasActiveInterpreter?: boolean; // Whether we have an active interpreter or not.
    };
    /**
     * Telemetry event sent if there's an error installing a jupyter required dependency
     *
     * @type { product: string }
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.JupyterInstallFailed]: {
        /**
         * Product being installed (jupyter or ipykernel or other)
         */
        product: string;
    };
    /**
     * Telemetry event sent when installing a jupyter dependency
     *
     * @type {product: string}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.UserInstalledModule]: { product: string };
    /**
     * Telemetry event sent to when user customizes the jupyter command line
     * @type {(undefined | never)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.JupyterCommandLineNonDefault]: undefined | never;
    /**
     * Telemetry event sent when a user runs the interactive window with a new file
     * @type {(undefined | never)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.NewFileForInteractiveWindow]: undefined | never;
    /**
     * Telemetry event sent when a kernel picked crashes on startup
     * @type {(undefined | never)}
     * @memberof IEventNamePropertyMapping
     */
    [Telemetry.KernelInvalid]: undefined | never;
    /**
     * Telemetry event sent when the ZMQ native binaries do not work.
     */
    [Telemetry.ZMQNotSupported]: undefined | never;
    /**
     * Telemetry event sent when the ZMQ native binaries do work.
     */
    [Telemetry.ZMQSupported]: undefined | never;
    /**
     * Telemetry event sent with name of a Widget that is used.
     */
    [Telemetry.HashedIPyWidgetNameUsed]: {
        /**
         * Hash of the widget
         */
        hashedName: string;
        /**
         * Where did we find the hashed name (CDN or user environment or remote jupyter).
         */
        source?: 'cdn' | 'local' | 'remote';
        /**
         * Whether we searched CDN or not.
         */
        cdnSearched: boolean;
    };
    /**
     * Telemetry event sent with name of a Widget found.
     */
    [Telemetry.HashedIPyWidgetNameDiscovered]: {
        /**
         * Hash of the widget
         */
        hashedName: string;
        /**
         * Where did we find the hashed name (CDN or user environment or remote jupyter).
         */
        source?: 'cdn' | 'local' | 'remote';
    };
    /**
     * Total time taken to discover all IPyWidgets.
     * This is how long it takes to discover all widgets on disc (from python environment).
     */
    [Telemetry.DiscoverIPyWidgetNamesPerf]: {
        /**
         * Whether we're looking for widgets on local Jupyter environment (local connections) or remote.
         */
        type: 'local' | 'remote';
    };
    /**
     * Something went wrong in looking for a widget.
     */
    [Telemetry.HashedIPyWidgetScriptDiscoveryError]: never | undefined;
    /**
     * Telemetry event sent when an ipywidget module loads. Module name is hashed.
     */
    [Telemetry.IPyWidgetLoadSuccess]: { moduleHash: string; moduleVersion: string };
    /**
     * Telemetry event sent when an ipywidget module fails to load. Module name is hashed.
     */
    [Telemetry.IPyWidgetLoadFailure]: {
        isOnline: boolean;
        moduleHash: string;
        moduleVersion: string;
        // Whether we timedout getting the source of the script (fetching script source in extension code).
        timedout: boolean;
    };
    /**
     * Telemetry event sent when an ipywidget version that is not supported is used & we have trapped this and warned the user abou it.
     */
    [Telemetry.IPyWidgetWidgetVersionNotSupportedLoadFailure]: { moduleHash: string; moduleVersion: string };
    /**
     * Telemetry event sent when an loading of 3rd party ipywidget JS scripts from 3rd party source has been disabled.
     */
    [Telemetry.IPyWidgetLoadDisabled]: { moduleHash: string; moduleVersion: string };
    /**
     * Total time taken to discover a widget script on CDN.
     */
    [Telemetry.DiscoverIPyWidgetNamesCDNPerf]: {
        // The CDN we were testing.
        cdn: string;
        // Whether we managed to find the widget on the CDN or not.
        exists: boolean;
    };
    /**
     * Telemetry sent when we prompt user to use a CDN for IPyWidget scripts.
     * This is always sent when we display a prompt.
     */
    [Telemetry.IPyWidgetPromptToUseCDN]: never | undefined;
    /**
     * Telemetry sent when user does something with the prompt displayed to user about using CDN for IPyWidget scripts.
     */
    [Telemetry.IPyWidgetPromptToUseCDNSelection]: {
        selection: 'ok' | 'cancel' | 'dismissed' | 'doNotShowAgain';
    };
    /**
     * Telemetry event sent to indicate the overhead of syncing the kernel with the UI.
     */
    [Telemetry.IPyWidgetOverhead]: {
        totalOverheadInMs: number;
        numberOfMessagesWaitedOn: number;
        averageWaitTime: number;
        numberOfRegisteredHooks: number;
    };
    /**
     * Telemetry event sent when the widget render function fails (note, this may not be sufficient to capture all failures).
     */
    [Telemetry.IPyWidgetRenderFailure]: never | undefined;
    /**
     * Telemetry event sent when the widget tries to send a kernel message but nothing was listening
     */
    [Telemetry.IPyWidgetUnhandledMessage]: {
        msg_type: string;
    };

    // Telemetry send when we create a notebook for a raw kernel or jupyter
    [Telemetry.RawKernelCreatingNotebook]: never | undefined;
    /**
     * After starting a kernel we send a request to get the kernel info.
     * This tracks the total time taken to get the response back (or wether we timedout).
     * If we timeout and later we find successful comms for this session, then timeout is too low
     * or we need more attempts.
     */
    [Telemetry.RawKernelInfoResonse]: {
        /**
         * Total number of attempts and sending a request and waiting for response.
         */
        attempts: number;
        /**
         * Whether we timedout while waiting for response for Kernel info request.
         */
        timedout: boolean;
    };
    [Telemetry.JupyterCreatingNotebook]: never | undefined | TelemetryErrorProperties;
    // Telemetry sent when starting auto starting Native Notebook kernel fails silently.
    [Telemetry.KernelStartFailedAndUIDisabled]: never | undefined;

    // Raw kernel timing events
    [Telemetry.RawKernelSessionConnect]: never | undefined;
    [Telemetry.RawKernelStartRawSession]: never | undefined;
    [Telemetry.RawKernelProcessLaunch]: never | undefined;

    // Applies to everything (interactive+Notebooks & local+remote)
    /**
     * Executes a cell, applies to IW and Notebook.
     * Check the `resourceType` to determine whether its a Jupyter Notebook or IW.
     */
    [Telemetry.ExecuteCell]: ResourceSpecificTelemetryProperties;
    /**
     * Starts a kernel, applies to IW and Notebook.
     * Check the `resourceType` to determine whether its a Jupyter Notebook or IW.
     */
    [Telemetry.NotebookStart]:
        | ResourceSpecificTelemetryProperties // If successful.
        | ({
              failed: true;
              failureCategory: ErrorCategory | KernelFailureReason;
          } & ResourceSpecificTelemetryProperties)
        | (ResourceSpecificTelemetryProperties & TelemetryErrorProperties); // If there any any unhandled exceptions.
    /**
     * Triggered when the kernel selection changes (note: This can also happen automatically when a notebook is opened).
     * WARNING: Due to changes in VS Code, this isn't necessarily a user action, hence difficult to tell if the user changed it or it changed automatically.
     */
    [Telemetry.SwitchKernel]: ResourceSpecificTelemetryProperties; // If there are unhandled exceptions;
    /**
     * Similar to Telemetry.SwitchKernel, but doesn't contain as much information as Telemetry.SwitchKernel.
     * WARNING: Due to changes in VS Code, this isn't necessarily a user action, hence difficult to tell if the user changed it or it changed automatically.
     */
    [Telemetry.SwitchToExistingKernel]: { language: string };
    [Telemetry.SwitchToInterpreterAsKernel]: never | undefined;
    /**
     * Total time taken to interrupt a kernel
     * Check the `resourceType` to determine whether its a Jupyter Notebook or IW.
     */
    [Telemetry.NotebookInterrupt]:
        | ({
              /**
               * The result of the interrupt,
               */
              result: InterruptResult;
          } & ResourceSpecificTelemetryProperties) // If successful (interrupted, timeout, restart).
        | (ResourceSpecificTelemetryProperties & TelemetryErrorProperties); // If there are unhandled exceptions;
    /**
     * Restarts the Kernel.
     * Check the `resourceType` to determine whether its a Jupyter Notebook or IW.
     */
    [Telemetry.NotebookRestart]:
        | {
              /**
               * If true, this is the total time taken to restart the kernel (excluding times to stop current cells and the like).
               * Also in the case of raw kernels, we keep a separate process running, and when restarting we just switch to that process.
               * In such cases this value will be `undefined`. In the case of raw kernels this will be true only when starting a new kernel process from scratch.
               */
              startTimeOnly: true;
          }
        | ({
              failed: true;
              failureCategory: ErrorCategory;
          } & ResourceSpecificTelemetryProperties)
        | (ResourceSpecificTelemetryProperties & TelemetryErrorProperties); // If there are unhandled exceptions;

    // Raw kernel single events
    [Telemetry.RawKernelSessionStart]:
        | ResourceSpecificTelemetryProperties
        | ({
              failed: true;
              failureCategory: ErrorCategory;
          } & ResourceSpecificTelemetryProperties)
        | (ResourceSpecificTelemetryProperties & TelemetryErrorProperties); // If there are unhandled exceptions;
    [Telemetry.RawKernelSessionStartSuccess]: never | undefined;
    [Telemetry.RawKernelSessionStartException]: never | undefined;
    [Telemetry.RawKernelSessionStartTimeout]: never | undefined;
    [Telemetry.RawKernelSessionStartUserCancel]: never | undefined;
    [Telemetry.RawKernelSessionStartNoIpykernel]: {
        reason: KernelInterpreterDependencyResponse;
    } & TelemetryErrorProperties;
    /**
     * This event is sent when the underlying kernelProcess for a
     * RawJupyterSession exits.
     */
    [Telemetry.RawKernelSessionKernelProcessExited]: {
        /**
         * The kernel process's exit reason, based on the error
         * object's reason
         */
        exitReason: string | undefined;
        /**
         * The kernel process's exit code.
         */
        exitCode: number | undefined;
    };
    /**
     * This event is sent when a RawJupyterSession's `shutdownSession`
     * method is called.
     */
    [Telemetry.RawKernelSessionShutdown]: {
        /**
         * This indicates whether the session being shutdown
         * is a restart session.
         */
        isRequestToShutdownRestartSession: boolean | undefined;
        /**
         * This is the callstack at the time that the `shutdownSession`
         * method is called, intended for us to be ale to identify who
         * tried to shutdown the session.
         */
        stacktrace: string | undefined;
    };
    /**
     * This event is sent when a RawSession's `dispose` method is called.
     */
    [Telemetry.RawKernelSessionDisposed]: {
        /**
         * This is the callstack at the time that the `dispose` method
         * is called, intended for us to be able to identify who called
         * `dispose` on the RawSession.
         */
        stacktrace: string | undefined;
    };

    // Run by line events
    [Telemetry.RunByLineStart]: never | undefined;
    [Telemetry.RunByLineStep]: never | undefined;
    [Telemetry.RunByLineStop]: never | undefined;
    [Telemetry.RunByLineVariableHover]: never | undefined;

    // Misc
    [Telemetry.KernelCount]: {
        kernelSpecCount: number; // Total number of kernel specs in the kernel list.
        kernelInterpreterCount: number; // Total number of interpreters in the kernel list.
        kernelLiveCount: number; // Total number of live kernels in the kernel list.
        /**
         * Total number of conda environments that share the same interpreter
         * This happens when we create conda envs without the `python` argument.
         * Such conda envs don't work today in the extension.
         * Hence users with such environments could hvae issues with starting kernels or packages not getting loaded correctly or at all.
         */
        condaEnvsSharingSameInterpreter: number;
    } & ResourceSpecificTelemetryProperties;

    [Telemetry.VSCNotebookCellTranslationFailed]: {
        isErrorOutput: boolean; // Whether we're trying to translate an error output when we shuldn't be.
    };

    // Sync events
    [Telemetry.SyncAllCells]: never | undefined;
    [Telemetry.SyncSingleCell]: never | undefined;

    // When users connect to a remote kernel, we store the kernel id so we can re-connect to that
    // when user opens the same notebook. We only store the last 100.
    // Count is the number of entries saved in the list.
    [Telemetry.NumberOfSavedRemoteKernelIds]: { count: number };

    // Whether we've attempted to start a raw Python kernel without any interpreter information.
    // If we don't detect such telemetry in a few months, then we can remove this along with the temporary code associated with this telemetry.
    [Telemetry.AttemptedToLaunchRawKernelWithoutInterpreter]: {
        /**
         * Indicates whether the python extension is installed.
         * If we send telemetry fro this & this is `true`, then we have a bug.
         * If its `false`, then we can ignore this telemetry.
         */
        pythonExtensionInstalled: boolean;
    };
    // Capture telemetry re: how long returning a tooltip takes
    [Telemetry.InteractiveFileTooltipsPerf]: {
        // Result is null if user signalled cancellation or if we timed out
        isResultNull: boolean;
    };

    // Native variable view events
    [Telemetry.NativeVariableViewLoaded]: never | undefined;
    [Telemetry.NativeVariableViewMadeVisible]: never | undefined;
    /**
     * Telemetry sent when a command is executed.
     */
    [Telemetry.CommandExecuted]: {
        /**
         * Name of the command executed.
         */
        command: string;
    };
    /**
     * Telemetry event sent whenever the user toggles the checkbox
     * controlling whether a slice is currently being applied to an
     * n-dimensional variable.
     */
    [Telemetry.DataViewerSliceEnablementStateChanged]: {
        /**
         * This property is either 'checked' when the result of toggling
         * the checkbox is for slicing to be enabled, or 'unchecked'
         * when the result of toggling the checkbox is for slicing
         * to be disabled.
         */
        newState: CheckboxState;
    };
    /**
     * Telemetry event sent when a slice is first applied in a
     * data viewer instance to a sliceable Python variable.
     */
    [Telemetry.DataViewerDataDimensionality]: {
        /**
         * This property represents the number of dimensions
         * on the target variable being sliced. This should
         * always be 2 at minimum.
         */
        numberOfDimensions: number;
    };
    /**
     * Telemetry event sent whenever the user applies a valid slice
     * to a sliceable Python variable in the data viewer.
     */
    [Telemetry.DataViewerSliceOperation]: {
        /**
         * This property indicates whether the slice operation
         * was triggered using the dropdown or the textbox in
         * the slice control panel. `source` is one of `dropdown`,
         * `textbox`, or `checkbox`.
         */
        source: SliceOperationSource;
    };
    /*
     * Telemetry sent when we fail to create a Notebook Controller (an entry for the UI kernel list in Native Notebooks).
     */
    [Telemetry.FailedToCreateNotebookController]: {
        /**
         * What kind of kernel spec did we fail to create.
         */
        kind:
            | 'startUsingPythonInterpreter'
            | 'startUsingDefaultKernel'
            | 'startUsingLocalKernelSpec'
            | 'startUsingRemoteKernelSpec'
            | 'connectToLiveRemoteKernel';
    } & Partial<TelemetryErrorProperties>;
    /*
     * Telemetry sent when we recommend installing an extension.
     */
    [Telemetry.RecommendExtension]: {
        /**
         * Extension we recommended the user to install.
         */
        extensionId: string;
        /**
         * `displayed` - If prompt was displayed
         * `dismissed` - If prompt was displayed & dismissed by the user
         * `ok` - If prompt was displayed & ok clicked by the user
         * `cancel` - If prompt was displayed & cancel clicked by the user
         * `doNotShowAgain` - If prompt was displayed & doNotShowAgain clicked by the user
         */
        action: 'displayed' | 'dismissed' | 'ok' | 'cancel' | 'doNotShowAgain';
    };
    [DebuggingTelemetry.clickedOnSetup]: never | undefined;
    [DebuggingTelemetry.closedModal]: never | undefined;
    [DebuggingTelemetry.ipykernel6Status]: {
        status: 'installed' | 'notInstalled';
    };
    [DebuggingTelemetry.clickedRunByLine]: never | undefined;
    [DebuggingTelemetry.successfullyStartedRunByLine]: never | undefined;
    /**
     * Telemetry sent when we have managed to successfully start the Interactive Window debugger using the Jupyter protocol.
     */
    [DebuggingTelemetry.successfullyStartedIWJupyterDebugger]: never | undefined;
    [DebuggingTelemetry.clickedRunAndDebugCell]: never | undefined;
    [DebuggingTelemetry.successfullyStartedRunAndDebugCell]: never | undefined;
    [DebuggingTelemetry.endedSession]: {
        reason: 'normally' | 'onKernelDisposed' | 'onAnInterrupt' | 'onARestart' | 'withKeybinding';
    };
    [Telemetry.JupyterKernelApiUsage]: {
        extensionId: string;
        pemUsed: keyof IExportedKernelService;
    };
    [Telemetry.JupyterKernelApiAccess]: {
        extensionId: string;
        allowed: 'yes' | 'no';
    };
    [Telemetry.KernelStartupCodeFailure]: {
        ename: string;
        evalue: string;
    };
    [Telemetry.UserStartupCodeFailure]: {
        ename: string;
        evalue: string;
    };
    [Telemetry.PythonVariableFetchingCodeFailure]: {
        ename: string;
        evalue: string;
    };
    [Telemetry.InteractiveWindowDebugSetupCodeFailure]: {
        ename: string;
        evalue: string;
    };
    [Telemetry.KernelCrash]: never | undefined;
    [Telemetry.JupyterKernelHiddenViaFilter]: never | undefined;
    [Telemetry.JupyterKernelFilterUsed]: never | undefined;
    /**
     * Telemetry sent when we have loaded some controllers.
     */
    [Telemetry.FetchControllers]: {
        /**
         * Whether this is from a cached result or not
         */
        cached: boolean;
        /**
         * Whether we've loaded local or remote controllers.
         */
        kind: 'local' | 'remote';
    };
    [Telemetry.RunTest]: {
        testName: string;
        testResult: string;
        perfWarmup?: 'true';
        commitHash?: string;
        timedCheckpoints?: string;
    };
    [Telemetry.PreferredKernelExactMatch]: {
        matchedReason: PreferredKernelExactMatchReason;
    };
    /**
     * Event sent when trying to talk to a remote server and the browser gives us a generic fetch error
     */
    [Telemetry.FetchError]: {
        /**
         * What we were doing when the fetch error occurred
         */
        currentTask: 'connecting';
    };
    /*
     * Telemetry event sent to provide information on whether we have successfully identify the type of shell used.
     * This information is useful in determining how well we identify shells on users machines.
     * This impacts extraction of env variables from current shell.
     * So, the better this works, the better it is for the user.
     * failed - If true, indicates we have failed to identify the shell. Note this impacts impacts ability to activate environments in the terminal & code.
     * shellIdentificationSource - How was the shell identified. One of 'terminalName' | 'settings' | 'environment' | 'default'
     *                             If terminalName, then this means we identified the type of the shell based on the name of the terminal.
     *                             If settings, then this means we identified the type of the shell based on user settings in VS Code.
     *                             If environment, then this means we identified the type of the shell based on their environment (env variables, etc).
     *                                 I.e. their default OS Shell.
     *                             If default, then we reverted to OS defaults (cmd on windows, and bash on the rest).
     *                                 This is the worst case scenario.
     *                                 I.e. we could not identify the shell at all.
     * hasCustomShell - If undefined (not set), we didn't check.
     *                  If true, user has customzied their shell in VSC Settings.
     * hasShellInEnv - If undefined (not set), we didn't check.
     *                 If true, user has a shell in their environment.
     *                 If false, user does not have a shell in their environment.
     */
    [Telemetry.TerminalShellIdentification]: {
        failed: boolean;
        reason: 'unknownShell' | undefined;
        terminalProvided: boolean;
        shellIdentificationSource: 'terminalName' | 'settings' | 'environment' | 'default' | 'vscode';
        hasCustomShell: undefined | boolean;
        hasShellInEnv: undefined | boolean;
    };

    /**
     * Telemetry sent only when we fail to extract the env variables for a shell.
     */
    [Telemetry.TerminalEnvVariableExtraction]: {
        failed: true;
        reason:
            | 'unknownOs'
            | 'getWorkspace'
            | 'terminalCreation'
            | 'fileCreation'
            | 'shellDetection'
            | 'commandExecution'
            | 'waitForCommand'
            | 'parseOutput'
            | undefined;
        shellType: TerminalShellType | undefined;
    };
    [Telemetry.JupyterInstalled]:
        | {
              failed: true;
              reason: 'notInstalled';
              frontEnd: 'notebook' | 'lab';
          }
        | {
              /**
               * Jupyter is in current path of process owned by VS Code.
               * I.e. jupyter can be found in the path as defined by the env variable process.env['PATH'].
               */
              detection: 'process';
              frontEnd: 'notebook' | 'lab';
              /**
               * Version of the form 6.11, 4.8
               */
              frontEndVersion: number;
          }
        | {
              /**
               * Jupyter is in current path of terminal owned by VS Code.
               * I.e. jupyter can be found in the path as defined by the env variable in a terminal of VS Code.
               */
              detection: 'shell';
              shellType: TerminalShellType;
              frontEnd: 'notebook' | 'lab';
              /**
               * Version of the form 6.11, 4.8
               */
              frontEndVersion: number;
          };
    /**
     * Telemetry event sent once we've successfully or unsuccessfully parsed the extension.js file in the widget folder.
     * E.g. if we have a widget named ipyvolume, we attempt to parse the nbextensions/ipyvolume/extension.js file to get some info out of it.
     */
    [Telemetry.IPyWidgetExtensionJsInfo]:
        | {
              /**
               * Hash of the widget folder name.
               */
              widgetFolderNameHash: string;
              /**
               * Total number of entries in the require config.
               */
              requireEntryPointCount: number;
              /**
               * Pattern (code style) used to register require.config enties.
               */
              patternUsedToRegisterRequireConfig: string;
          }
        | {
              /**
               * Hash of the widget folder name.
               */
              widgetFolderNameHash: string;
              failed: true;
              failure: 'couldNotLocateRequireConfigStart' | 'couldNotLocateRequireConfigEnd' | 'noRequireConfigEntries';
              /**
               * Pattern (code style) used to register require.config enties.
               */
              patternUsedToRegisterRequireConfig: string | undefined;
          };
    /**
     * Total time take to copy the nb extensions folder.
     */
    [Telemetry.IPyWidgetNbExtensionCopyTime]: never | undefined;
    /**
     * Useful when we need an active kernel session in order to execute commands silently.
     * Used by the dataViewerDependencyService.
     */
    [Telemetry.NoActiveKernelSession]: never | undefined;
    /**
     * When the Data Viewer installer is using the Python interpreter.
     */
    [Telemetry.DataViewerUsingInterpreter]: never | undefined;
    /**
     * When the Data Viewer installer is using the Kernel.
     */
    [Telemetry.DataViewerUsingKernel]: never | undefined;
}
