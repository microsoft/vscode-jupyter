// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

export const pythonKernelDebugAdapter = 'Python Kernel Debug Adapter';

export enum DebuggingTelemetry {
    clickedOnSetup = 'DATASCIENCE.DEBUGGING.CLICKED_ON_SETUP',
    closedModal = 'DATASCIENCE.DEBUGGING.CLOSED_MODAL',
    ipykernel6Status = 'DATASCIENCE.DEBUGGING.IPYKERNEL6_STATUS',
    clickedRunByLine = 'DATASCIENCE.DEBUGGING.CLICKED_RUNBYLINE',
    successfullyStartedRunByLine = 'DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUNBYLINE',
    clickedRunAndDebugCell = 'DATASCIENCE.DEBUGGING.CLICKED_RUN_AND_DEBUG_CELL',
    successfullyStartedRunAndDebugCell = 'DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUN_AND_DEBUG_CELL',
    endedSession = 'DATASCIENCE.DEBUGGING.ENDED_SESSION'
}
