// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as nbformat from '@jupyterlab/nbformat';
import { IKernelConnectionSession, KernelConnectionMetadata } from './types';
import { Uri } from 'vscode';
import { traceError, traceVerbose } from '../platform/logging';
import { Resource } from '../platform/common/types';
import { concatMultilineString } from '../platform/common/utils';
import { trackKernelResourceInformation } from './telemetry/helper';
import { areInterpreterPathsSame } from '../platform/pythonEnvironments/info/interpreter';
import { executeSilently, isPythonKernelConnection } from './helpers';

export async function sendTelemetryForPythonKernelExecutable(
    session: IKernelConnectionSession,
    resource: Resource,
    kernelConnection: KernelConnectionMetadata
) {
    if (!kernelConnection.interpreter || !isPythonKernelConnection(kernelConnection)) {
        return;
    }
    if (
        kernelConnection.kind !== 'startUsingLocalKernelSpec' &&
        kernelConnection.kind !== 'startUsingPythonInterpreter'
    ) {
        return;
    }
    try {
        traceVerbose('Begin sendTelemetryForPythonKernelExecutable');
        const outputs = await executeSilently(session, 'import sys\nprint(sys.executable)');
        if (outputs.length === 0) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const output: nbformat.IStream = outputs[0] as any;
        if (output.name !== 'stdout' && output.output_type !== 'stream') {
            return;
        }
        const sysExecutable = concatMultilineString(output.text).trim().toLowerCase();
        const match = areInterpreterPathsSame(kernelConnection.interpreter.uri, Uri.file(sysExecutable));
        await trackKernelResourceInformation(resource, { interpreterMatchesKernel: match });
    } catch (ex) {
        traceError('Failed to compare interpreters', ex);
    }
    traceVerbose('End sendTelemetryForPythonKernelExecutable');
}
