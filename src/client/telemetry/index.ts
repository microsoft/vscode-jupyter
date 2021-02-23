// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { JSONObject } from '@phosphor/coreutils';
// eslint-disable-next-line
import TelemetryReporter from 'vscode-extension-telemetry/lib/telemetryReporter';

import { IWorkspaceService } from '../common/application/types';
import { AppinsightsKey, isTestExecution, isUnitTestExecution, JVSC_EXTENSION_ID } from '../common/constants';
import { traceError, traceInfo } from '../common/logger';
import { StopWatch } from '../common/utils/stopWatch';
import {
    JupyterCommands,
    NativeKeyboardCommandTelemetry,
    NativeMouseCommandTelemetry,
    Telemetry,
    VSCodeNativeTelemetry
} from '../datascience/constants';
import { ResourceSpecificTelemetryProperties } from '../datascience/telemetry/types';
import { ExportFormat } from '../datascience/export/types';
import { InterruptResult } from '../datascience/types';
import { EventName, PlatformErrors } from './constants';
import { populateTelemetryWithErrorInfo } from '../common/errors';
import { ErrorCategory, TelemetryErrorProperties } from '../common/errors/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Checks whether telemetry is supported.
 * Its possible this function gets called within Debug Adapter, vscode isn't available in there.
 * Within DA, there's a completely different way to send telemetry.
 * @returns {boolean}
 */
function isTelemetrySupported(): boolean {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vsc = require('vscode');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const reporter = require('vscode-extension-telemetry');
        return vsc !== undefined && reporter !== undefined;
    } catch {
        return false;
    }
}

/**
 * Checks if the telemetry is disabled in user settings
 * @returns {boolean}
 */
export function isTelemetryDisabled(workspaceService: IWorkspaceService): boolean {
    const settings = workspaceService.getConfiguration('telemetry').inspect<boolean>('enableTelemetry')!;
    return settings.globalValue === false ? true : false;
}

const sharedProperties: Record<string, any> = {};
/**
 * Set shared properties for all telemetry events.
 */
export function setSharedProperty<P extends ISharedPropertyMapping, E extends keyof P>(name: E, value?: P[E]): void {
    const propertyName = name as string;
    // Ignore such shared telemetry during unit tests.
    if (isUnitTestExecution() && propertyName.startsWith('ds_')) {
        return;
    }
    if (value === undefined) {
        delete sharedProperties[propertyName];
    } else {
        sharedProperties[propertyName] = value;
    }
}

/**
 * Reset shared properties for testing purposes.
 */
export function _resetSharedProperties(): void {
    for (const key of Object.keys(sharedProperties)) {
        delete sharedProperties[key];
    }
}

let telemetryReporter: TelemetryReporter | undefined;
function getTelemetryReporter() {
    if (!isTestExecution() && telemetryReporter) {
        return telemetryReporter;
    }
    const extensionId = JVSC_EXTENSION_ID;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extensions = (require('vscode') as typeof import('vscode')).extensions;
    const extension = extensions.getExtension(extensionId)!;
    const extensionVersion = extension.packageJSON.version;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reporter = require('vscode-extension-telemetry').default as typeof TelemetryReporter;
    return (telemetryReporter = new reporter(extensionId, extensionVersion, AppinsightsKey, true));
}

export function clearTelemetryReporter() {
    telemetryReporter = undefined;
}

function stringifyProperties(eventName: string, data: Record<string, any>) {
    let customProperties: Record<string, string> = {};
    Object.getOwnPropertyNames(data).forEach((prop) => {
        if (data[prop] === undefined || data[prop] === null) {
            return;
        }
        try {
            // If there are any errors in serializing one property, ignore that and move on.
            // Else nothing will be sent.
            customProperties[prop] =
                typeof data[prop] === 'string'
                    ? data[prop]
                    : typeof data[prop] === 'object'
                    ? 'object'
                    : data[prop].toString();
        } catch (ex) {
            traceError(`Failed to serialize ${prop} for ${eventName}`, ex);
        }
    });
    return customProperties;
}
export function sendTelemetryEvent<P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    durationMs?: Record<string, number> | number,
    properties?: P[E],
    ex?: Error,
    sendOriginalEventWithErrors?: boolean
) {
    if (isTestExecution() || !isTelemetrySupported()) {
        return;
    }
    const reporter = getTelemetryReporter();
    const measures = typeof durationMs === 'number' ? { duration: durationMs } : durationMs ? durationMs : undefined;
    let customProperties: Record<string, string> = {};
    let eventNameSent = eventName as string;

    if (ex) {
        if (!sendOriginalEventWithErrors) {
            // When sending telemetry events for exceptions no need to send custom properties.
            // Else we have to review all properties every time as part of GDPR.
            // Assume we have 10 events all with their own properties.
            // As we have errors for each event, those properties are treated as new data items.
            // Hence they need to be classified as part of the GDPR process, and thats unnecessary and onerous.
            eventNameSent = 'ERROR';
            customProperties = {
                originalEventName: eventName as string
            };
            // Add shared properties to telemetry props (we may overwrite existing ones).
            Object.assign(customProperties, sharedProperties);
            populateTelemetryWithErrorInfo(customProperties, ex);
            customProperties = stringifyProperties(eventNameSent, customProperties);
            reporter.sendTelemetryErrorEvent(eventNameSent, customProperties, measures, []);
        } else {
            // Include a property failed, to indicate there are errors.
            // Lets pay the price for better data.
            customProperties = {};
            // Add shared properties to telemetry props (we may overwrite existing ones).
            Object.assign(customProperties, sharedProperties);
            Object.assign(customProperties, properties || {});
            populateTelemetryWithErrorInfo(customProperties, ex);
            customProperties = stringifyProperties(eventNameSent, customProperties);
            reporter.sendTelemetryEvent(eventNameSent, customProperties, measures);
        }
    } else {
        if (properties) {
            customProperties = stringifyProperties(eventNameSent, properties);
        }

        // Add shared properties to telemetry props (we may overwrite existing ones).
        Object.assign(customProperties, sharedProperties);

        reporter.sendTelemetryEvent(eventNameSent, customProperties, measures);
    }

    if (process.env && process.env.VSC_JUPYTER_LOG_TELEMETRY) {
        traceInfo(
            `Telemetry Event : ${eventNameSent} Measures: ${JSON.stringify(measures)} Props: ${JSON.stringify(
                customProperties
            )} `
        );
    }
}

// Type-parameterized form of MethodDecorator in lib.es5.d.ts.
type TypedMethodDescriptor<T> = (
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
) => TypedPropertyDescriptor<T> | void;

/**
 * Decorates a method, sending a telemetry event with the given properties.
 * @param eventName The event name to send.
 * @param properties Properties to send with the event; must be valid for the event.
 * @param captureDuration True if the method's execution duration should be captured.
 * @param failureEventName If the decorated method returns a Promise and fails, send this event instead of eventName.
 * @param lazyProperties A static function on the decorated class which returns extra properties to add to the event.
 * This can be used to provide properties which are only known at runtime (after the decorator has executed).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any,
export function captureTelemetry<This, P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    properties?: P[E],
    captureDuration: boolean = true,
    failureEventName?: E,
    lazyProperties?: (obj: This) => P[E]
): TypedMethodDescriptor<(this: This, ...args: any[]) => any> {
    // eslint-disable-next-line , @typescript-eslint/no-explicit-any
    return function (
        _target: Object,
        _propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(this: This, ...args: any[]) => any>
    ) {
        const originalMethod = descriptor.value!;
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        descriptor.value = function (this: This, ...args: any[]) {
            // Legacy case; fast path that sends event before method executes.
            // Does not set "failed" if the result is a Promise and throws an exception.
            if (!captureDuration && !lazyProperties) {
                sendTelemetryEvent(eventName, undefined, properties);
                // eslint-disable-next-line no-invalid-this
                return originalMethod.apply(this, args);
            }

            const props = () => {
                if (lazyProperties) {
                    return { ...properties, ...lazyProperties(this) };
                }
                return properties;
            };

            const stopWatch = captureDuration ? new StopWatch() : undefined;

            // eslint-disable-next-line no-invalid-this, @typescript-eslint/no-use-before-define,
            const result = originalMethod.apply(this, args);

            // If method being wrapped returns a promise then wait for it.
            // eslint-disable-next-line
            if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
                // eslint-disable-next-line
                (result as Promise<void>)
                    .then((data) => {
                        sendTelemetryEvent(eventName, stopWatch?.elapsedTime, props());
                        return data;
                    })
                    // eslint-disable-next-line @typescript-eslint/promise-function-async
                    .catch((ex) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const failedProps: P[E] = props() || ({} as any);
                        (failedProps as any).failed = true;
                        sendTelemetryEvent(
                            failureEventName ? failureEventName : eventName,
                            stopWatch?.elapsedTime,
                            failedProps,
                            ex
                        );
                    });
            } else {
                sendTelemetryEvent(eventName, stopWatch?.elapsedTime, props());
            }

            return result;
        };

        return descriptor;
    };
}

// function sendTelemetryWhenDone<T extends IDSMappings, K extends keyof T>(eventName: K, properties?: T[K]);
export function sendTelemetryWhenDone<P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    promise: Promise<any> | Thenable<any>,
    stopWatch?: StopWatch,
    properties?: P[E],
    sendOriginalEventWithErrors?: boolean
) {
    stopWatch = stopWatch ? stopWatch : new StopWatch();
    if (typeof promise.then === 'function') {
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        (promise as Promise<any>).then(
            (data) => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                sendTelemetryEvent(eventName, stopWatch!.elapsedTime, properties);
                return data;
                // eslint-disable-next-line @typescript-eslint/promise-function-async
            },
            (ex) => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                sendTelemetryEvent(eventName, stopWatch!.elapsedTime, properties, ex, sendOriginalEventWithErrors);
                return Promise.reject(ex);
            }
        );
    } else {
        throw new Error('Method is neither a Promise nor a Theneable');
    }
}

/**
 * Map all shared properties to their data types.
 */
export interface ISharedPropertyMapping {
    /**
     * Whether user ran a cell or not.
     * Its possible we have auto start enabled, in which case things could fall over
     * (jupyter not start, kernel not start), and these are all not user initiated events.
     * Hence sending telemetry indicating failure in starting a kernel could be misleading.
     * This tells us that user started the action.
     */
    userExecutedCell: 'true';
    /**
     * For every DS telemetry we would like to know the type of Notebook Editor used when doing something.
     */
    ['ds_notebookeditor']: undefined | 'old' | 'custom' | 'native';
    /**
     * For every DS telemetry we would like to know whether the this is from AML compute or not.
     * If not in AML compute, then do not send this telemetry.
     */
    ['isamlcompute']: 'true' | 'false';

    /**
     * For every telemetry event from the extension we want to make sure we can associate it with install
     * source. We took this approach to work around very limiting query performance issues.
     */
    ['installSource']: undefined | 'marketPlace' | 'pythonCodingPack';

    /**
     * Whether raw kernel is supported or not.
     */
    ['rawKernelSupported']: 'true' | 'false';

    /**
     * Whether using local or remote connection.
     */
    ['localOrRemoteConnection']: 'local' | 'remote';

    /**
     * Whether using local or remote connection.
     */
    ['isPythonExtensionInstalled']: 'true' | 'false';
}

// Map all events to their properties
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
        hashedName: string;
    };
    [Telemetry.HashedCellOutputMimeTypePerf]: never | undefined;
    [Telemetry.KernelListingPerf]: never | undefined;
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
    [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST]: never | undefined;
    [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR]: never | undefined;
    [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS]: never | undefined;
    // Data Science
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
    [Telemetry.ConnectRemoteSelfCertFailedJupyter]: never | undefined;
    [Telemetry.RegisterAndUseInterpreterAsKernel]: never | undefined;
    [Telemetry.UseInterpreterAsKernel]: never | undefined;
    [Telemetry.UseExistingKernel]: never | undefined;
    [Telemetry.SwitchToExistingKernel]: { language: string };
    [Telemetry.SwitchToInterpreterAsKernel]: never | undefined;
    [Telemetry.ConvertToPythonFile]: never | undefined;
    [Telemetry.CopySourceCode]: never | undefined;
    [Telemetry.CreateNewNotebook]: never | undefined;
    [Telemetry.DataScienceSettings]: JSONObject;
    [Telemetry.DebugContinue]: never | undefined;
    [Telemetry.DebugCurrentCell]: never | undefined;
    [Telemetry.DebugStepOver]: never | undefined;
    [Telemetry.DebugStop]: never | undefined;
    [Telemetry.DebugFileInteractive]: never | undefined;
    [Telemetry.DeleteAllCells]: never | undefined;
    [Telemetry.DeleteCell]: never | undefined;
    [Telemetry.FindJupyterCommand]: { command: string };
    [Telemetry.FindJupyterKernelSpec]: never | undefined;
    [Telemetry.DisableInteractiveShiftEnter]: never | undefined;
    [Telemetry.EnableInteractiveShiftEnter]: never | undefined;
    [Telemetry.ExecuteCellTime]: never | undefined;
    /**
     * Telemetry sent to capture first time execution of a cell.
     * If `notebook = true`, this its telemetry for native editor/notebooks.
     */
    [Telemetry.ExecuteCellPerceivedCold]: undefined | { notebook: boolean };
    /**
     * Telemetry sent to capture subsequent execution of a cell.
     * If `notebook = true`, this its telemetry for native editor/notebooks.
     */
    [Telemetry.ExecuteCellPerceivedWarm]: undefined | { notebook: boolean };
    /**
     * Time take for jupyter server to start and be ready to run first user cell.
     */
    [Telemetry.PerceivedJupyterStartupNotebook]: never | undefined;
    /**
     * Time take for jupyter server to be busy from the time user first hit `run` cell until jupyter reports it is busy running a cell.
     */
    [Telemetry.StartExecuteNotebookCellPerceivedCold]: never | undefined;
    [Telemetry.ExecuteNativeCell]: never | undefined;
    [Telemetry.ExpandAll]: never | undefined;
    [Telemetry.ExportNotebookInteractive]: never | undefined;
    [Telemetry.ExportPythonFileInteractive]: never | undefined;
    [Telemetry.ExportPythonFileAndOutputInteractive]: never | undefined;
    [Telemetry.ClickedExportNotebookAsQuickPick]: { format: ExportFormat };
    [Telemetry.ExportNotebookAs]: { format: ExportFormat; cancelled?: boolean; successful?: boolean; opened?: boolean };
    [Telemetry.ExportNotebookAsCommand]: { format: ExportFormat };
    [Telemetry.ExportNotebookAsFailed]: { format: ExportFormat };
    [Telemetry.GetPasswordAttempt]: never | undefined;
    [Telemetry.GetPasswordFailure]: never | undefined;
    [Telemetry.GetPasswordSuccess]: never | undefined;
    [Telemetry.GotoSourceCode]: never | undefined;
    [Telemetry.HiddenCellTime]: never | undefined;
    [Telemetry.ImportNotebook]: { scope: 'command' | 'file' };
    [Telemetry.Interrupt]: never | undefined;
    [Telemetry.InterruptJupyterTime]: never | undefined;
    [Telemetry.NotebookRunCount]: { count: number };
    [Telemetry.NotebookWorkspaceCount]: { count: number };
    [Telemetry.NotebookOpenCount]: { count: number };
    [Telemetry.NotebookOpenTime]: number;
    [Telemetry.PandasNotInstalled]: never | undefined;
    [Telemetry.PandasTooOld]: never | undefined;
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
    [Telemetry.RemoteAddCode]: never | undefined;
    [Telemetry.RemoteReexecuteCode]: never | undefined;
    [Telemetry.RestartJupyterTime]: never | undefined;
    [Telemetry.RestartKernel]: never | undefined;
    [Telemetry.RestartKernelCommand]: never | undefined;
    /**
     * Run Cell Commands in Interactive Python
     */
    [Telemetry.RunAllCells]: never | undefined;
    [Telemetry.RunSelectionOrLine]: never | undefined;
    [Telemetry.RunCell]: never | undefined;
    [Telemetry.RunCurrentCell]: never | undefined;
    [Telemetry.RunAllCellsAbove]: never | undefined;
    [Telemetry.RunCellAndAllBelow]: never | undefined;
    [Telemetry.RunCurrentCellAndAdvance]: never | undefined;
    [Telemetry.RunToLine]: never | undefined;
    [Telemetry.RunFileInteractive]: never | undefined;
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
        commandSource: 'nonUser' | 'commandPalette' | 'toolbar' | 'nativeNotebookStatusBar' | 'nativeNotebookToolbar';
    };
    [Telemetry.SetJupyterURIToLocal]: never | undefined;
    [Telemetry.SetJupyterURIToUserSpecified]: {
        azure: boolean;
    };
    [Telemetry.ShiftEnterBannerShown]: never | undefined;
    [Telemetry.StartShowDataViewer]: never | undefined;
    [Telemetry.ShowDataViewer]: { rows: number | undefined; columns: number | undefined };
    [Telemetry.FailedShowDataViewer]: never | undefined;
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
    [Telemetry.WebviewMonacoStyleUpdate]: never | undefined;
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
     * Total time taken to find a kernel on disc.
     */
    [Telemetry.KernelFinderPerf]: undefined | never;
    /**
     * Total time taken to list kernels for VS Code.
     */
    [Telemetry.KernelProviderPerf]: undefined | never;
    /**
     * Total time taken to get the preferred kernel for notebook.
     */
    [Telemetry.GetPreferredKernelPerf]: undefined | never;
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
     * Total time taken to discover all IPyWidgets on disc.
     * This is how long it takes to discover a single widget on disc (from python environment).
     */
    [Telemetry.DiscoverIPyWidgetNamesLocalPerf]: never | undefined;
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
    [Telemetry.JupyterCreatingNotebook]: never | undefined | TelemetryErrorProperties;
    // Telemetry sent when starting auto starting Native Notebook kernel fails silently.
    [Telemetry.KernelStartFailedAndUIDisabled]: never | undefined;

    // Raw kernel timing events
    [Telemetry.RawKernelSessionConnect]: never | undefined;
    [Telemetry.RawKernelStartRawSession]: never | undefined;
    [Telemetry.RawKernelProcessLaunch]: never | undefined;

    // Applies to everything (interactive+Notebooks & local+remote)
    [Telemetry.ExecuteCell]: ResourceSpecificTelemetryProperties;
    [Telemetry.NotebookStart]:
        | ResourceSpecificTelemetryProperties // If successful.
        | ({
              failed: true;
              failureCategory: ErrorCategory;
          } & ResourceSpecificTelemetryProperties)
        | (ResourceSpecificTelemetryProperties & TelemetryErrorProperties); // If there any any unhandled exceptions.
    [Telemetry.SwitchKernel]: ResourceSpecificTelemetryProperties; // If there are unhandled exceptions;
    [Telemetry.NotebookInterrupt]:
        | ({ result: InterruptResult } & ResourceSpecificTelemetryProperties) // If successful (interrupted, timeout, restart).
        | (ResourceSpecificTelemetryProperties & TelemetryErrorProperties); // If there are unhandled exceptions;
    [Telemetry.NotebookRestart]:
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
        reason: number;
    } & TelemetryErrorProperties;

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
    } & ResourceSpecificTelemetryProperties;

    // Trusted notebooks events
    [Telemetry.NotebookTrustPromptShown]: never | undefined;
    [Telemetry.TrustNotebook]: never | undefined;
    [Telemetry.TrustAllNotebooks]: never | undefined;
    [Telemetry.DoNotTrustNotebook]: never | undefined;
    [Telemetry.NativeRandomBytesGenerationFailed]: [never | undefined];

    // Native notebooks events
    [VSCodeNativeTelemetry.AddCell]: never | undefined;
    [VSCodeNativeTelemetry.DeleteCell]: never | undefined;
    [VSCodeNativeTelemetry.MoveCell]: never | undefined;
    [VSCodeNativeTelemetry.ChangeToCode]: never | undefined;
    [VSCodeNativeTelemetry.ChangeToMarkdown]: never | undefined;
    [VSCodeNativeTelemetry.RunAllCells]: never | undefined;
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
}
