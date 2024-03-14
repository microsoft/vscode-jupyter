// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../platform/vscode-path/path';
import type * as nbformat from '@jupyterlab/nbformat';
import { IJupyterKernelSpec, IKernelSession, isLocalConnection, KernelConnectionMetadata } from './types';
import { Uri } from 'vscode';
import { traceError, traceVerbose } from '../platform/logging';
import { Resource } from '../platform/common/types';
import { concatMultilineString } from '../platform/common/utils';
import { trackKernelResourceInformation } from './telemetry/helper';
import { areInterpreterPathsSame } from '../platform/pythonEnvironments/info/interpreter';
import { executeSilently, isPythonKernelConnection } from './helpers';
import { PYTHON_LANGUAGE } from '../platform/common/constants';
import { StopWatch } from '../platform/common/utils/stopWatch';

export async function sendTelemetryForPythonKernelExecutable(
    session: IKernelSession,
    resource: Resource,
    kernelConnection: KernelConnectionMetadata
) {
    if (
        !kernelConnection.interpreter ||
        !isPythonKernelConnection(kernelConnection) ||
        !session.kernel ||
        session.kernel.status === 'dead' ||
        session.kernel.status === 'terminating'
    ) {
        return;
    }
    if (
        kernelConnection.kind !== 'startUsingLocalKernelSpec' &&
        kernelConnection.kind !== 'startUsingPythonInterpreter'
    ) {
        return;
    }
    const stopWatch = new StopWatch();
    try {
        const outputs = await executeSilently(
            session.kernel,
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
        traceError(`Failed to compare interpreters after ${stopWatch.elapsedTime}ms`, ex);
    }
}

/**
 * Whether this is a kernel that will be launched via a Python executable.
 * Any kernelSpec where the first argument (in argv) is `python` or `python3` will be launched via a Python executable.
 */
function isKernelLaunchedViaLocalPythonProcess(kernel: KernelConnectionMetadata | IJupyterKernelSpec) {
    const connection = 'kernelSpec' in kernel ? kernel : undefined;
    // We generate these, and these kernels are always started by us using Python code.
    if (connection?.kind === 'startUsingPythonInterpreter') {
        return true;
    }
    if (connection && !isLocalConnection(connection)) {
        return false;
    }
    const kernelSpec = connection ? connection.kernelSpec : (kernel as IJupyterKernelSpec);
    return isLikelyAPythonExecutable(kernelSpec.argv[0]); // This covers cases like python.exe, python3, python3.10;
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
    const connection = 'kernelSpec' in kernel ? kernel : undefined;
    // We generate these, and these kernels are always started by us using Python code.
    if (connection?.kind === 'startUsingPythonInterpreter') {
        return true;
    }
    if (connection && !isLocalConnection(connection)) {
        return false;
    }

    const kernelSpec = connection ? connection.kernelSpec : (kernel as IJupyterKernelSpec);
    if (kernelSpec.language && kernelSpec.language.toLowerCase() !== PYTHON_LANGUAGE) {
        return false;
    }
    if (!isKernelLaunchedViaLocalPythonProcess(kernel)) {
        return false;
    }
    const moduleIndex = kernelSpec.argv.indexOf('-m');
    if (moduleIndex === -1) {
        return false;
    }
    const moduleName =
        kernelSpec.argv.length - 1 >= moduleIndex ? kernelSpec.argv[moduleIndex + 1].toLowerCase() : undefined;
    if (!moduleName) {
        return false;
    }
    // We are only interested in global kernels that don't use ipykernel_launcher.
    return moduleName.includes('ipykernel_launcher') || moduleName.includes('ipykernel');
}

export function isLikelyAPythonExecutable(executable: string) {
    executable = path.basename(executable).trim().toLowerCase();
    return (
        executable === 'python' ||
        executable === 'python3' ||
        executable === 'python.exe' ||
        executable === 'python3.exe'
    );
}
