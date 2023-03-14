// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const pythonKernelDebugAdapter = 'Python Kernel Debug Adapter';
export const pythonIWKernelDebugAdapter = 'Python Interactive Window Debug Adapter';

export enum DebuggingTelemetry {
    clickedOnSetup = 'DATASCIENCE.DEBUGGING.CLICKED_ON_SETUP',
    closedModal = 'DATASCIENCE.DEBUGGING.CLOSED_MODAL',
    ipykernel6Status = 'DATASCIENCE.DEBUGGING.IPYKERNEL_SIX_STATUS',
    clickedRunByLine = 'DATASCIENCE.DEBUGGING.CLICKED_RUNBYLINE',
    successfullyStartedRunByLine = 'DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUNBYLINE',
    successfullyStartedIWJupyterDebugger = 'DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_IW_JUPYTER',
    clickedRunAndDebugCell = 'DATASCIENCE.DEBUGGING.CLICKED_RUN_AND_DEBUG_CELL',
    successfullyStartedRunAndDebugCell = 'DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUN_AND_DEBUG_CELL',
    endedSession = 'DATASCIENCE.DEBUGGING.ENDED_SESSION'
}
