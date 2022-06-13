/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as nbformat from '@jupyterlab/nbformat';
import { IKernel, KernelConnectionMetadata } from './types';
import { Uri } from 'vscode';
import { traceError, traceVerbose } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IPythonExecutionFactory } from '../platform/common/process/types.node';
import { Resource } from '../platform/common/types';
import { trackKernelResourceInformation } from './telemetry/helper';
import { areInterpreterPathsSame } from '../platform/pythonEnvironments/info/interpreter';
import { sendTelemetryEvent } from '../telemetry';
import { concatMultilineString } from '../webviews/webview-side/common';
import { Telemetry } from '../webviews/webview-side/common/constants';
import { executeSilently, isPythonKernelConnection } from './helpers';

export async function sendTelemetryForPythonKernelExecutable(
    kernel: IKernel,
    resource: Resource,
    kernelConnection: KernelConnectionMetadata,
    executionService: IPythonExecutionFactory
) {
    if (!kernel.session) {
        return;
    }
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
        const outputs = await executeSilently(kernel.session, 'import sys\nprint(sys.executable)');
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
        sendTelemetryEvent(Telemetry.PythonKerneExecutableMatches, undefined, {
            match: match ? 'true' : 'false',
            kernelConnectionType: kernelConnection.kind
        });
        trackKernelResourceInformation(resource, { interpreterMatchesKernel: match });
        if (match) {
            return;
        }

        // Rest of the code can all be async, no need to slow the calling code.

        // The interpreter paths don't match, possible we have a synlink or similar.
        // Lets try to get the path from the interpreter using the exact same code we send to the kernel.
        executionService
            .createActivatedEnvironment({
                interpreter: kernelConnection.interpreter,
                allowEnvironmentFetchExceptions: true
            })
            .then(async (execService) => {
                const execOutput = await execService.exec(['-c', 'import sys;print(sys.executable)'], {
                    throwOnStdErr: false
                });
                if (execOutput.stdout.trim().length > 0) {
                    const match = areInterpreterPathsSame(
                        Uri.file(execOutput.stdout.trim().toLowerCase()),
                        Uri.file(sysExecutable)
                    );
                    sendTelemetryEvent(Telemetry.PythonKerneExecutableMatches, undefined, {
                        match: match ? 'true' : 'false',
                        kernelConnectionType: kernelConnection.kind
                    });
                    trackKernelResourceInformation(resource, { interpreterMatchesKernel: match });
                    if (!match) {
                        traceError(
                            `Interpreter started by kernel does not match expectation, expected ${getDisplayPath(
                                kernelConnection.interpreter?.uri
                            )}, got ${getDisplayPath(Uri.file(sysExecutable))}`
                        );
                    }
                }
            })
            .catch((ex) => traceError('Failed to compare interpreters', ex));
    } catch (ex) {
        traceError('Failed to compare interpreters', ex);
    }
    traceVerbose('End sendTelemetryForPythonKernelExecutable');
}
