// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, Disposable } from 'vscode';
import { IKernel } from '../../../kernels/types';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { createKernelApiForExtension } from './kernel';
import { DisposableStore } from '../../../platform/common/utils/lifecycle';
import { raceCancellation, wrapCancellationTokens } from '../../../platform/common/cancellation';
import { CellOutputMimeTypes, getNotebookCellOutputMetadata } from '../../../kernels/execution/helpers';
import { unTrackDisplayDataForExtension } from '../../../kernels/execution/extensionDisplayDataTracker';
import { logger } from '../../../platform/logging';
import { Delayer } from '../../../platform/common/utils/async';

export const executionCounters = new WeakMap<IKernel, number>();
export async function execCodeInBackgroundThread<T>(
    kernel: IKernel,
    codeWithReturnStatement: string[],
    token: CancellationToken
) {
    const counter = executionCounters.get(kernel) || 0;
    executionCounters.set(kernel, counter + 1);
    const { api } = createKernelApiForExtension(JVSC_EXTENSION_ID, kernel);
    const mime = `application/vnd.vscode.bg.execution.${counter}`;
    const mimeFinalResult = `application/vnd.vscode.bg.execution.${counter}.result`;
    const mimeErrorResult = `application/vnd.vscode.bg.execution.${counter}.error`;
    let displayId = '';

    const codeToSend = `
def __jupyter_exec_background__():
    from IPython.display import display
    from ipykernel import __version__ as ipykernel_version
    from threading import Thread
    from traceback import format_exc

    # First send a dummy response to get the display id.
    # Later we'll send the real response with the actual data.
    # And that can happen much later even after the execution completes,
    # as that response will be sent from a bg thread.
    output = display({"${mime}": ipykernel_version}, raw=True, display_id=True)

    def do_implementation():
        ${codeWithReturnStatement.map((l, i) => (i === 0 ? l : `        ${l}`)).join('\n')}

    def bg_main():
        try:
            output.update({"${mimeFinalResult}": do_implementation()}, raw=True)
        except Exception as e:
            output.update({"${mimeErrorResult}": format_exc()}, raw=True)


    Thread(target=bg_main, daemon=True).start()


__jupyter_exec_background__()
del __jupyter_exec_background__
`.trim();
    let lastStdError = '';
    const disposables = new DisposableStore();
    disposables.add(
        new Disposable(() => {
            // We no longer need to track any more outputs from the kernel that are related to this output.
            kernel.session && unTrackDisplayDataForExtension(kernel.session, displayId);
        })
    );
    const wrappedCancellation = disposables.add(wrapCancellationTokens(token));
    disposables.add(wrappedCancellation.token.onCancellationRequested(() => disposables.dispose()));
    const promise = raceCancellation(
        wrappedCancellation.token,
        new Promise<T | undefined>((resolve, reject) => {
            disposables.add(
                api.onDidReceiveDisplayUpdate(async (output) => {
                    if (wrappedCancellation.token.isCancellationRequested) {
                        return resolve(undefined);
                    }
                    const metadata = getNotebookCellOutputMetadata(output);
                    if (!displayId || metadata?.transient?.display_id !== displayId) {
                        return;
                    }
                    const result = output.items.find((item) => item.mime === mimeFinalResult);
                    if (!result) {
                        return;
                    }

                    try {
                        return resolve(JSON.parse(new TextDecoder().decode(result.data)) as T);
                    } catch (ex) {
                        return reject(new Error('Failed to parse the result', ex));
                    }
                })
            );
        })
    ).finally(() => disposables.dispose());

    let ipyKernelVersion = '';
    const exitIfFailuresFound = new Delayer(5_000);

    for await (const output of api.executeCode(codeToSend, wrappedCancellation.token)) {
        if (token.isCancellationRequested) {
            return;
        }
        const metadata = getNotebookCellOutputMetadata(output);
        if (!metadata?.transient?.display_id) {
            if (
                output.metadata?.outputType === 'stream' &&
                output.items.length &&
                output.items[0].mime === CellOutputMimeTypes.stderr
            ) {
                lastStdError += new TextDecoder().decode(output.items[0].data);
                if (lastStdError && ipyKernelVersion.startsWith('7.0.1')) {
                    // ipykernel 7.0.1 has a bug where background thread errors are printed to stderr
                    // https://github.com/ipython/ipykernel/issues/1450
                    wrappedCancellation.cancel();
                } else {
                    logger.trace('Background execution stderr:', lastStdError);
                }
            }
            continue;
        }
        const dummyMessage = output.items.find((item) => item.mime === mime);
        if (dummyMessage) {
            displayId = metadata.transient.display_id;
            exitIfFailuresFound.cancel();

            try {
                ipyKernelVersion = new TextDecoder().decode(dummyMessage.data).trim();
                // Check if ipykernel version matches the pattern d.d.d<anything>
                if (!ipyKernelVersion.match(/^\d+\.\d+\.\d+/)) {
                    ipyKernelVersion = '';
                }
            } catch {
                // Ignore errors in decoding
            }
            continue;
        }

        if (displayId === metadata.transient.display_id) {
            const result = output.items.find((item) => item.mime === mimeFinalResult || item.mime === mimeErrorResult);
            if (result?.mime === mimeFinalResult) {
                return JSON.parse(new TextDecoder().decode(result.data)) as T;
            } else if (result?.mime === mimeErrorResult) {
                logger.warn('Error in background execution:\n', new TextDecoder().decode(result.data));
                return;
            }
        }
    }
    try {
        if (wrappedCancellation.token.isCancellationRequested) {
            if (!token.isCancellationRequested && lastStdError && ipyKernelVersion.startsWith('7.0.1')) {
                throw new Error(lastStdError);
            }
            return;
        }
        if (!displayId) {
            logger.warn('Failed to get display id for completions');
            return;
        }
        const result = await raceCancellation(wrappedCancellation.token, promise);
        if (result) {
            return result;
        }
        if (wrappedCancellation.token.isCancellationRequested && !token.isCancellationRequested && lastStdError) {
            throw new Error(lastStdError);
        }
    } finally {
        if (lastStdError) {
            logger.error('Error in background execution:\n', lastStdError);
        }
    }
}
