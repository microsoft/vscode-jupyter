// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export type ConsoleType = 'internalConsole' | 'integratedTerminal' | 'externalTerminal';

export interface IKernelDebugAdapter {
    runByLineContinue(): void;

    runByLineStop(): void;
}
