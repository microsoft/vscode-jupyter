// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCellKind, workspace, type NotebookDocument, type Uri } from 'vscode';
import { DisposableStore } from '../../platform/common/utils/lifecycle';
import { isUri } from '../../platform/common/utils/misc';
import { once } from '../../platform/common/utils/functional';
import { sendKernelTelemetryEvent } from './sendKernelTelemetryEvent';
import { Telemetry } from '../../platform/common/constants';
import type { Environment } from '@vscode/python-extension';
import { getCellMetadata } from '../../platform/common/utils';
import { traceWarning } from '../../platform/logging';

/* eslint-disable @typescript-eslint/no-use-before-define */

let wasAnyCellExecutedInSession = false;
const notebooksOpenedTime = new WeakMap<NotebookDocument, ReturnType<typeof createNotebookTracker>>();
const uriToNotebookMap = new Map<string, WeakRef<NotebookDocument>>();
let mainStopWatch: { elapsedTime: number };
let mainStopWatchStartAt = 0;
export function getNotebookTelemetryTracker(query: NotebookDocument | Uri | undefined) {
    if (!query) {
        return;
    }
    if (isUri(query) && !uriToNotebookMap.has(query.toString())) {
        const nb = workspace.notebookDocuments.find((item) => item.uri.toString() === query.toString());
        if (nb) {
            uriToNotebookMap.set(query.toString(), new WeakRef(nb));
        }
    }
    const notebook = isUri(query) ? uriToNotebookMap.get(query.toString())?.deref() : query;
    if (!notebook) {
        return;
    }

    return notebooksOpenedTime.get(notebook)?.tracker;
}

export function activateNotebookTelemetry(stopWatch: { elapsedTime: number }) {
    const disposable = new DisposableStore();
    mainStopWatch = stopWatch;
    mainStopWatchStartAt = stopWatch.elapsedTime;
    workspace.notebookDocuments.forEach((nb) =>
        notebooksOpenedTime.set(nb, createNotebookTracker(nb, true, stopWatch))
    );
    disposable.add(
        workspace.onDidOpenNotebookDocument((e) => {
            if (!notebooksOpenedTime.has(e) && !wasAnyCellExecutedInSession) {
                notebooksOpenedTime.set(e, createNotebookTracker(e, false, stopWatch));
            }
        })
    );
    disposable.add(
        workspace.onDidCloseNotebookDocument((e) => {
            notebooksOpenedTime.delete(e);
            uriToNotebookMap.delete(e.uri.toString());
        })
    );
    return disposable;
}

export function onDidManuallySelectKernel(notebook: NotebookDocument) {
    notebooksOpenedTime.get(notebook)?.tracker.kernelManuallySelected();
}

type Times = {
    preExecuteCellTelemetry: number;
    startKernel: number;
    executeCell: number;
    sessionTelemetry: number;
    postKernelStart: number;
    computeCwd: number;
    kernelInfo: number;
    kernelIdle: number;
    kernelReady: number;
    getConnection: number;
    updateConnection: number;
    portUsage: number;
    spawn: number;
    pythonEnvVars: number;
    envVars: number;
    interruptHandle: number;
};
const pythonExtensionActivation = {
    starAfter: -1,
    completedAfter: -1
};
type ExtraTimes = {
    controllerCreated: number;
    interpreterDiscovered: number;
    executeCellAcknowledged: number;
};
export type NotebookFirstStartBreakDownMeasures = Partial<
    { [K in keyof Times as `${K}StartedAfter`]: number } & { [K in keyof ExtraTimes as `${K}After`]: number } & {
        [K in keyof Times as `${K}CompletedAfter`]: number;
    } & {
        openedAfter: number;
        executeCellCount?: number;
        kernelSelectedAfter?: number;
    }
>;
const controllerCreationTimes = new Map<string, number>();
const interpreterDiscoveryTimes = new Map<string, number>();
const controllerInterpreterMapping = new Map<string, string>();

export const trackPythonExtensionActivation = once(() => {
    pythonExtensionActivation.starAfter = mainStopWatch?.elapsedTime;
    return {
        stop: once(() => {
            pythonExtensionActivation.completedAfter = mainStopWatch.elapsedTime;
        })
    };
});

export function trackControllerCreation(kernelConnectionId: string, pythonInterpreterId?: string) {
    controllerCreationTimes.set(kernelConnectionId, mainStopWatch?.elapsedTime);
    controllerInterpreterMapping.set(kernelConnectionId, pythonInterpreterId || '');
}
export function trackInterpreterDiscovery(pythonEnv: Environment) {
    if (!pythonEnv.executable.uri) {
        return;
    }
    interpreterDiscoveryTimes.set(pythonEnv.id, mainStopWatch?.elapsedTime);
}
function createNotebookTracker(
    notebook: NotebookDocument,
    wasAlreadyOpen: boolean,
    stopWatch: { elapsedTime: number }
) {
    const notebookOpenTimeRelativeToActivation = mainStopWatch.elapsedTime;
    const openedAfter = stopWatch.elapsedTime;
    const measures: NotebookFirstStartBreakDownMeasures = {
        openedAfter
    };
    const createTracker = (measure: keyof Times) => {
        if (measure === 'executeCell') {
            wasAnyCellExecutedInSession = true;
        }
        measures[`${measure}StartedAfter`] = stopWatch.elapsedTime;
        const obj = {
            stop: once(() => {
                measures[`${measure}CompletedAfter`] = stopWatch.elapsedTime;
            })
        };
        return obj;
    };
    const info: {
        manuallySelectedKernel?: boolean;
        wasAlreadyOpen: boolean;
    } = {
        wasAlreadyOpen
    };
    const emptyTracker = () => undefined;
    return {
        measures,
        info,
        tracker: {
            kernelSelected: once((kernelConnectionId: string, interpreterId?: string) => {
                const controllerCreatedTime = controllerCreationTimes.get(kernelConnectionId);
                if (typeof controllerCreatedTime === 'number') {
                    if (info.wasAlreadyOpen) {
                        measures.controllerCreatedAfter = controllerCreationTimes.get(kernelConnectionId);
                    } else {
                        // Assumption is controller was created before the notebook was opened.
                        // If not, then this means we're still busy discovering the kernel.
                        // I.e. if this number is negative (< 0), then this means the controller was created after the notebook was opened (not the best UX).
                        measures.controllerCreatedAfter = notebookOpenTimeRelativeToActivation - controllerCreatedTime;
                    }
                }
                measures.interpreterDiscoveredAfter = interpreterDiscoveryTimes.get(interpreterId || '');
                measures.kernelSelectedAfter = stopWatch.elapsedTime;
                if (!info.manuallySelectedKernel) {
                    sendTelemetryForFirstAutoSelectedKernel(
                        notebook,
                        { wasAlreadyOpen: info.wasAlreadyOpen },
                        {
                            controllerCreatedAfter: measures.controllerCreatedAfter,
                            kernelSelectedAfter: measures.kernelSelectedAfter,
                            openedAfter: openedAfter,
                            interpreterDiscoveredAfter: measures.interpreterDiscoveredAfter
                        }
                    );
                }
            }),
            kernelManuallySelected: once(() => (info.manuallySelectedKernel = true)),
            // All of these are only tracked if a cell was executed in the session.
            // & we do them only once for the entire session.
            // I.e. if we execute a cell, then we do not need to track these ever again.
            cellExecutionCount: wasAnyCellExecutedInSession
                ? emptyTracker
                : once((count: number) => (measures.executeCellCount = count)),
            // Breakdown of running a cell.
            preExecuteCellTelemetry: wasAnyCellExecutedInSession
                ? emptyTracker
                : once(() => createTracker('preExecuteCellTelemetry')),
            startKernel: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('startKernel')),
            executeCell: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('executeCell')),
            executeCellAcknowledged: wasAnyCellExecutedInSession
                ? emptyTracker
                : once(() => {
                      measures.executeCellAcknowledgedAfter = stopWatch.elapsedTime;
                      sendTelemetry(notebook, info, measures);
                  }),
            // Breakdown of starting a kernel.
            jupyterSessionTelemetry: wasAnyCellExecutedInSession
                ? emptyTracker
                : once(() => createTracker('sessionTelemetry')),
            postKernelStartup: wasAnyCellExecutedInSession
                ? emptyTracker
                : once(() => createTracker('postKernelStart')),
            computeCwd: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('computeCwd')),
            getConnection: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('getConnection')),
            updateConnection: wasAnyCellExecutedInSession
                ? emptyTracker
                : once(() => createTracker('updateConnection')),
            kernelReady: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('kernelReady')),
            portUsage: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('portUsage')),
            spawn: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('spawn')),
            // Breakdown of spawning the kernel
            pythonEnvVars: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('pythonEnvVars')),
            envVars: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('envVars')),
            interruptHandle: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('interruptHandle')),
            // Breakdown of post startup
            kernelInfo: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('kernelInfo')),
            kernelIdle: wasAnyCellExecutedInSession ? emptyTracker : once(() => createTracker('kernelIdle'))
        }
    };
}

type StartupSummary = {
    sessionTelemetry: number;
    postKernelStart: number;
    computeCwd: number;
    kernelReady: number;
    getConnection: number;
    updateConnection: number;
    portUsage: number;
    spawn: number;
};
type PostKernelStartupSummary = {
    startupCode: number;
    kernelInfo: number;
    kernelIdle: number;
};
type SpawnSummary = {
    pythonEnvVars: number;
    envVars: number;
    interruptHandle: number;
};
type NotebookSummary = {
    /**
     * Number of code cells in the notebook.
     */
    codeCellCount: number;
    /**
     * Number of md cells in the notebook.
     */
    mdCellCount: number;
    /**
     * Total char length of all text in all code cells.
     */
    codeCellCharLength: number;
    /**
     * Total char length of all text in all md cells.
     */
    mdCellCharLength: number;
    /**
     * Total number of outputs in all cells.
     */
    outputCount: number;
    /**
     * Total bytes of all outputs in all cells.
     */
    outputsByteSize: number;
    /**
     * Total number of attachments
     */
    attachmentCount: number;
    /**
     * Total number of chars in the attachment (generally these are base64 encoded strings).
     */
    attachmentCharLength: number;
};
const sendTelemetry = once(function (
    notebook: NotebookDocument,
    info: {
        executeCellCount?: number;
        manuallySelectedKernel?: boolean;
        wasAlreadyOpen: boolean;
    },
    measures: NotebookFirstStartBreakDownMeasures
) {
    if (
        typeof measures.preExecuteCellTelemetryStartedAfter !== 'number' ||
        typeof measures.preExecuteCellTelemetryCompletedAfter !== 'number' ||
        typeof measures.executeCellAcknowledgedAfter !== 'number' ||
        typeof measures.startKernelStartedAfter !== 'number' ||
        typeof measures.startKernelCompletedAfter !== 'number' ||
        typeof measures.executeCellStartedAfter !== 'number' ||
        typeof measures.sessionTelemetryStartedAfter !== 'number' ||
        typeof measures.sessionTelemetryCompletedAfter !== 'number' ||
        typeof measures.postKernelStartStartedAfter !== 'number' ||
        typeof measures.postKernelStartCompletedAfter !== 'number' ||
        typeof measures.kernelInfoStartedAfter !== 'number' ||
        typeof measures.kernelInfoCompletedAfter !== 'number' ||
        typeof measures.kernelIdleStartedAfter !== 'number' ||
        typeof measures.kernelIdleCompletedAfter !== 'number' ||
        typeof measures.computeCwdStartedAfter !== 'number' ||
        typeof measures.computeCwdCompletedAfter !== 'number' ||
        typeof measures.kernelReadyStartedAfter !== 'number' ||
        typeof measures.kernelReadyCompletedAfter !== 'number' ||
        typeof measures.getConnectionStartedAfter !== 'number' ||
        typeof measures.getConnectionCompletedAfter !== 'number' ||
        typeof measures.updateConnectionStartedAfter !== 'number' ||
        typeof measures.updateConnectionCompletedAfter !== 'number' ||
        typeof measures.portUsageStartedAfter !== 'number' ||
        typeof measures.portUsageCompletedAfter !== 'number' ||
        typeof measures.spawnStartedAfter !== 'number' ||
        typeof measures.spawnCompletedAfter !== 'number' ||
        typeof measures.pythonEnvVarsStartedAfter !== 'number' ||
        typeof measures.pythonEnvVarsCompletedAfter !== 'number' ||
        typeof measures.envVarsStartedAfter !== 'number' ||
        typeof measures.envVarsCompletedAfter !== 'number'
    ) {
        return;
    }
    // We are only interested in events that happen after the notebook was opened.
    // E.g. If the controller was created before the notebook was created, then we do not care about that.
    type BriefSummary = {
        duration: number;
        preExecuteCellTelemetry: number;
        startKernel: number;
        executeCell?: number;
    };
    const briefSummary: BriefSummary = { duration: 0, preExecuteCellTelemetry: 0, startKernel: 0, executeCell: 0 };
    {
        const briefSummaryParts: { name: keyof BriefSummary; start: number; end: number }[] = [
            {
                name: 'preExecuteCellTelemetry',
                start: measures.preExecuteCellTelemetryStartedAfter,
                end: measures.preExecuteCellTelemetryCompletedAfter
            },
            {
                name: 'startKernel',
                start: measures.startKernelStartedAfter,
                end: measures.startKernelCompletedAfter
            },
            {
                name: 'executeCell',
                start: measures.executeCellStartedAfter,
                end: measures.executeCellAcknowledgedAfter
            }
        ];
        const duration = measures.executeCellAcknowledgedAfter - measures.preExecuteCellTelemetryStartedAfter;
        briefSummary.duration = duration;
        computeSummary(briefSummary, briefSummaryParts, duration, measures.openedAfter);
    }
    // Generate the summary of the kernel startup,
    const startupSummary: StartupSummary = {
        sessionTelemetry: 0,
        postKernelStart: 0,
        computeCwd: 0,
        getConnection: 0,
        updateConnection: 0,
        kernelReady: 0,
        portUsage: 0,
        spawn: 0
    };
    {
        const startupSummaryParts: { name: keyof StartupSummary; start: number; end: number }[] = [
            {
                name: 'sessionTelemetry',
                start: measures.sessionTelemetryStartedAfter,
                end: measures.sessionTelemetryCompletedAfter
            },
            {
                name: 'postKernelStart',
                start: measures.postKernelStartStartedAfter,
                end: measures.postKernelStartCompletedAfter
            },
            {
                name: 'computeCwd',
                start: measures.computeCwdStartedAfter,
                end: measures.computeCwdCompletedAfter
            },
            {
                name: 'getConnection',
                start: measures.getConnectionStartedAfter,
                end: measures.getConnectionCompletedAfter
            },
            {
                name: 'updateConnection',
                start: measures.updateConnectionStartedAfter,
                end: measures.updateConnectionCompletedAfter
            },
            {
                name: 'spawn',
                start: measures.spawnStartedAfter,
                end: measures.spawnCompletedAfter
            },
            {
                name: 'portUsage',
                start: measures.portUsageStartedAfter,
                end: measures.portUsageCompletedAfter
            },
            {
                name: 'kernelReady',
                start: measures.kernelReadyStartedAfter,
                end: measures.kernelReadyCompletedAfter
            }
        ];

        const duration = measures.startKernelCompletedAfter - measures.startKernelStartedAfter;
        computeSummary(startupSummary, startupSummaryParts, duration, measures.openedAfter);
    }

    // Summary of the breakdown of post kernel startup.
    const postKernelStartSummary: PostKernelStartupSummary = {
        startupCode: 0,
        kernelInfo: 0,
        kernelIdle: 0
    };
    {
        const postKernelStartSummaryParts: { name: keyof PostKernelStartupSummary; start: number; end: number }[] = [
            {
                name: 'startupCode',
                start: measures.postKernelStartStartedAfter,
                end: measures.kernelInfoStartedAfter
            },
            {
                name: 'kernelInfo',
                start: measures.kernelInfoStartedAfter,
                end: measures.kernelInfoCompletedAfter
            },
            {
                name: 'kernelIdle',
                start: measures.kernelIdleStartedAfter,
                end: measures.kernelIdleCompletedAfter
            }
        ];

        const duration = measures.postKernelStartCompletedAfter - measures.postKernelStartStartedAfter;
        computeSummary(postKernelStartSummary, postKernelStartSummaryParts, duration, measures.openedAfter);
    }

    // Summary of the breakdown of spawning kernel process.
    const spawnSummary: SpawnSummary = {
        pythonEnvVars: 0,
        envVars: 0,
        interruptHandle: 0
    };
    {
        const spawnSummaryParts: { name: keyof SpawnSummary; start: number; end: number }[] = [
            {
                name: 'pythonEnvVars',
                start: measures.pythonEnvVarsStartedAfter,
                end: measures.pythonEnvVarsCompletedAfter
            },
            {
                name: 'envVars',
                start: measures.envVarsStartedAfter,
                end: measures.envVarsCompletedAfter
            },
            {
                name: 'interruptHandle',
                start: measures.interruptHandleStartedAfter || 0,
                end: measures.interruptHandleCompletedAfter || 0
            }
        ];

        const duration = measures.spawnCompletedAfter - measures.spawnStartedAfter;
        computeSummary(spawnSummary, spawnSummaryParts, duration, measures.openedAfter);
    }
    const notebookSummary = computeNotebookSummary(notebook);
    const allMeasures: BriefSummary & StartupSummary & PostKernelStartupSummary & SpawnSummary = {
        ...briefSummary,
        ...startupSummary,
        ...postKernelStartSummary,
        ...spawnSummary,
        ...notebookSummary
    };
    sendKernelTelemetryEvent(notebook.uri, Telemetry.NotebookFirstStartBreakDown, allMeasures, info);
});

function computeNotebookSummary(notebook: NotebookDocument) {
    const notebookSummary: NotebookSummary = {
        attachmentCharLength: 0,
        attachmentCount: 0,
        codeCellCharLength: 0,
        codeCellCount: 0,
        mdCellCharLength: 0,
        mdCellCount: 0,
        outputCount: 0,
        outputsByteSize: 0
    };

    notebook.getCells().forEach((cell) => {
        const lastChar = cell.document.lineAt(cell.document.lineCount - 1).range.end;
        const length = cell.document.offsetAt(lastChar);
        if (cell.kind === NotebookCellKind.Markup) {
            notebookSummary.mdCellCount += 1;
            notebookSummary.mdCellCharLength += length;
            try {
                const metadata = getCellMetadata(cell);
                const attachments = (metadata.attachments || {}) as unknown as Record<string, string>;
                Object.keys(attachments).forEach((key) => {
                    notebookSummary.attachmentCount += 1;
                    const attachment = attachments[key] as unknown as Record<string, string>;
                    if (typeof attachment === 'object') {
                        Object.keys(attachment).forEach((mime) => {
                            const value = attachment[mime];
                            if (value && typeof value === 'string') {
                                notebookSummary.attachmentCharLength += value.length;
                            }
                        });
                    }
                });
            } catch (error) {
                traceWarning(`Error parsing attachments in cell metadata`, error);
            }
        } else {
            notebookSummary.codeCellCount += 1;
            notebookSummary.codeCellCharLength += length;
            notebookSummary.outputCount += cell.outputs.length;
            notebookSummary.outputsByteSize += cell.outputs.reduce(
                (acc, output) => acc + output.items.reduce((itemTotal, item) => itemTotal + item.data.byteLength, 0),
                0
            );
        }
    });

    return notebookSummary;
}
const sendTelemetryForFirstAutoSelectedKernel = once(function (
    notebook: NotebookDocument,
    info: {
        wasAlreadyOpen: boolean;
    },
    measures: {
        openedAfter: number;
        kernelSelectedAfter: number;
        controllerCreatedAfter?: number;
        interpreterDiscoveredAfter?: number;
        pythonExtensionActivationStartedAfter?: number;
        pythonExtensionActivationCompletedAfter?: number;
    }
) {
    measures.pythonExtensionActivationStartedAfter = pythonExtensionActivation.starAfter;
    measures.pythonExtensionActivationCompletedAfter = pythonExtensionActivation.completedAfter;
    if (
        typeof measures.controllerCreatedAfter === 'undefined' ||
        typeof measures.interpreterDiscoveredAfter === 'undefined' ||
        typeof measures.pythonExtensionActivationCompletedAfter === 'undefined' ||
        typeof measures.pythonExtensionActivationStartedAfter === 'undefined'
    ) {
        return;
    }

    // We are only interested in events that happen after the notebook was opened.
    // E.g. If the controller was created before the notebook was created, then we do not care about that.
    type Summary = {
        duration: number;
        callPythonApi?: number;
        activatePython?: number;
        discoverEnv?: number;
        createController?: number;
        selectController?: number;
    };
    const parts: { name: keyof Summary; start: number; end: number }[] = [
        {
            name: 'callPythonApi',
            start: mainStopWatchStartAt,
            end: measures.pythonExtensionActivationStartedAfter
        },
        {
            name: 'activatePython',
            start: measures.pythonExtensionActivationStartedAfter,
            end: measures.pythonExtensionActivationCompletedAfter
        },
        {
            name: 'discoverEnv',
            start: measures.pythonExtensionActivationCompletedAfter,
            end: measures.interpreterDiscoveredAfter
        },
        {
            name: 'createController',
            start: measures.interpreterDiscoveredAfter,
            end: measures.controllerCreatedAfter
        },
        {
            name: 'selectController',
            start: measures.controllerCreatedAfter,
            end: measures.kernelSelectedAfter
        }
    ];
    const duration = measures.kernelSelectedAfter - measures.openedAfter;
    const summary: Summary = { duration };
    computeSummary(summary, parts, duration, measures.openedAfter);
    sendKernelTelemetryEvent(notebook.uri, Telemetry.NotebookFirstKernelAutoSelectionBreakDown, summary, info);
});

function computeSummary(
    summary: { [k: string]: number },
    breakdown: {
        name: keyof typeof summary;
        start: number;
        end: number;
    }[],
    duration: number,
    marker?: number
) {
    breakdown
        .sort((a, b) => a.start - b.start)
        .forEach((item) => {
            // const property = item.name as keyof T;
            if (typeof marker === 'number' && marker >= item.start && marker <= item.end) {
                summary[item.name] = ((item.end - marker) * 100) / duration;
            } else if (typeof marker === 'number' && marker > item.end) {
                summary[item.name] = 0;
            } else if (typeof marker === 'number' && marker < item.start) {
                summary[item.name] = ((item.end - item.start) * 100) / duration;
            } else if (typeof marker !== 'number') {
                summary[item.name] = ((item.end - item.start) * 100) / duration;
            }
        });
}
