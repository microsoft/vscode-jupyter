// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as os from 'os';
import * as path from '../platform/vscode-path/path';
import * as nbformat from '@jupyterlab/nbformat';
import { IJupyterKernelSpec, IKernelConnectionSession, isLocalConnection, KernelConnectionMetadata } from './types';
import { Uri } from 'vscode';
import { traceError, traceVerbose } from '../platform/logging';
import { Resource } from '../platform/common/types';
import { concatMultilineString } from '../platform/common/utils';
import { trackKernelResourceInformation } from './telemetry/helper';
import { areInterpreterPathsSame } from '../platform/pythonEnvironments/info/interpreter';
import { executeSilently, isPythonKernelConnection } from './helpers';
import { PYTHON_LANGUAGE } from '../platform/common/constants';

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
        const outputs = await executeSilently(
            session,
            'import sys as _VSCODE_sys\nprint(_VSCODE_sys.executable); del _VSCODE_sys'
        );
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

/**
 * Whether this is a kernel that will be launched via a Python executable.
 * Any kernelSpec where the first argument (in argv) is `python` or `python3` will be launched via a Python executable.
 */
function isKernelLaunchedViaLocalPythonProcess(kernel: KernelConnectionMetadata | IJupyterKernelSpec) {
    const kernelSpec = 'kernelSpec' in kernel ? kernel.kernelSpec : undefined;
    const connection = 'kernelSpec' in kernel ? kernel : undefined;
    if (!kernelSpec || (connection && !isLocalConnection(connection))) {
        return false;
    }
    const expectedExecutable = os.platform() === 'win32' ? 'python.exe' : 'python';
    const expectedExecutable3 = os.platform() === 'win32' ? 'python3.exe' : 'python3';
    const executable = path.basename(kernelSpec.argv[0]).toLowerCase();
    return executable === expectedExecutable || executable === expectedExecutable3;
}

/**
 * Whether this is a kernel connection that points to a Local Python Kernel
 * that can be started by the extension manually via Python code (i.e. by running the Python modules).
 * Some times we have Python kernelSpecs created by users (or some other tool) where the first
 * item in argv points to something like `conda` or the like.
 * Basically these are custom kernels where users would like to run something against python or other but have full control over
 * how the process is launched.
 */
export function isKernelLaunchedViaLocalPythonIPyKernel(kernel: KernelConnectionMetadata | IJupyterKernelSpec) {
    const kernelSpec = 'kernelSpec' in kernel ? kernel.kernelSpec : undefined;
    const connection = 'kernelSpec' in kernel ? kernel : undefined;
    if (!kernelSpec || (connection && !isLocalConnection(connection))) {
        return false;
    }
    if (kernelSpec.language && kernelSpec.language.toLowerCase() !== PYTHON_LANGUAGE) {
        return false;
    }
    return (
        isKernelLaunchedViaLocalPythonProcess(kernel) &&
        kernelSpec.argv.some((arg) => arg.includes('ipykernel_launcher') || arg.includes('ipykernel'))
    );
}
