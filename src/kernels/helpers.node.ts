// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../platform/vscode-path/path';
import type * as nbformat from '@jupyterlab/nbformat';
import { IJupyterKernelSpec, IKernelSession, isLocalConnection, KernelConnectionMetadata } from './types';
import { CancellationToken, Uri } from 'vscode';
import { logger } from '../platform/logging';
import { Resource } from '../platform/common/types';
import { concatMultilineString } from '../platform/common/utils';
import { trackKernelResourceInformation } from './telemetry/helper';
import { areInterpreterPathsSame } from '../platform/pythonEnvironments/info/interpreter';
import { executeSilently, isPythonKernelConnection } from './helpers';
import { PYTHON_LANGUAGE } from '../platform/common/constants';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { Cancellation, raceCancellationError, wrapCancellationTokens } from '../platform/common/cancellation';

/**
 * Best-effort telemetry: runs a tiny `print(sys.executable)` in the kernel and records whether the
 * running interpreter matches the interpreter we think we started (`interpreterMatchesKernel`). This
 * helps us detect environment/interpreter mismatches in the wild. It is purely diagnostic — nothing
 * about startup correctness depends on it.
 *
 * Why this function is careful about *when* it runs:
 * This probe is fired from the `didStart` hook, which runs *inside* kernel initialization, i.e. while
 * the raw startup-recovery coordinator is still watching the kernel (see
 * {@link IKernelStartup}/`KernelStartupRecovery` and issue #17481). That means the `executeSilently`
 * request below is a real shell request the coordinator tracks, and because the hook is awaited it
 * can hold up `start()`. On a healthy kernel this is instant, but a kernel that acknowledges the
 * request and then stalls (or stalls during the telemetry bookkeeping) could otherwise wedge startup.
 * So we deliberately bound this optional work by the remaining startup budget:
 *
 *   - `cap` = how long we're willing to spend here, derived from the coordinator's remaining budget
 *     (leaving a 1s safety margin, and never more than 5s). When there is no coordinator
 *     (non-raw/non-Python), `cap` is `undefined` and we behave as before (no extra timing bound).
 *   - `cap === 0` means there's essentially no budget left, so we skip the probe entirely rather than
 *     risk eating into startup — returning here is the whole point: optional diagnostics must never
 *     delay getting the user a working kernel.
 *   - Otherwise a timer cancels the probe once `cap` elapses, and we also honor both the caller's
 *     token and the coordinator's token, so disposing the kernel or exhausting the budget aborts it.
 *
 * Trade-off we accept: capping the probe can occasionally drop a telemetry sample on very slow
 * starts. That's fine — a missing sample is far better than a diagnostic probe slowing kernel startup.
 *
 * @param session The kernel session to probe (only local raw Python sessions carry a `startup` budget).
 * @param resource The notebook/resource used to attribute the telemetry.
 * @param kernelConnection Connection metadata; the probe only runs for local Python kernels.
 * @param token Optional cancellation (e.g. the init/hook token) to abort the probe early.
 */
export async function sendTelemetryForPythonKernelExecutable(
    session: IKernelSession,
    resource: Resource,
    kernelConnection: KernelConnectionMetadata,
    token?: CancellationToken
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
    // Only local raw sessions have a startup-recovery coordinator with a time budget. For everything
    // else `startup` is undefined and we don't apply any extra time bound (`cap` stays undefined).
    const startup = session.kind === 'localRaw' ? session.startup : undefined;
    // How long we're willing to spend on this optional probe, derived from the coordinator's remaining
    // budget: leave a 1s safety margin for the kernel to finish starting, and never spend more than 5s.
    const cap = startup ? Math.min(5000, Math.max(0, startup.remainingTime - 1000)) : undefined;
    if (cap === 0) {
        // No startup budget left. Bail out *before* sending any request to the kernel so this
        // diagnostic telemetry can never delay (or wedge) the user's kernel startup. Example: a slow
        // kernel is 59s into a 60s budget — we'd rather skip the sample than risk the final second.
        logger.trace('Skipping executable telemetry to preserve the remaining startup budget');
        return;
    }
    // Abort the probe if the caller cancels (e.g. kernel disposed) or the coordinator's token fires
    // (e.g. the startup budget is exhausted), whichever happens first.
    const cancellation = wrapCancellationTokens(
        ...[token, startup?.token].filter((item): item is CancellationToken => !!item)
    );
    // Hard stop: even if the kernel acknowledges the request and then stalls, cancel after `cap` ms so
    // an awaited, optional telemetry probe can't hold up initialization. (No cap => no timer.)
    const timer = cap === undefined ? undefined : setTimeout(() => cancellation.cancel(), cap);
    try {
        const outputs = await executeSilently(
            session.kernel,
            'import sys as _VSCODE_sys\nprint(_VSCODE_sys.executable); del _VSCODE_sys',
            undefined,
            cancellation.token
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
        Cancellation.throwIfCanceled(cancellation.token);
        await raceCancellationError(
            cancellation.token,
            trackKernelResourceInformation(resource, { interpreterMatchesKernel: match })
        );
    } catch (ex) {
        if (cancellation.token.isCancellationRequested) {
            logger.trace(`Executable telemetry capture cancelled after ${stopWatch.elapsedTime}ms`);
        } else {
            logger.error(`Failed to compare interpreters after ${stopWatch.elapsedTime}ms`, ex);
        }
    } finally {
        clearTimeout(timer);
        cancellation.dispose();
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
