// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { IKernel } from '../../../kernels/types';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { createKernelApiForExtension } from './kernel';
import { DisposableStore } from '../../../platform/common/utils/lifecycle';
import { raceCancellation } from '../../../platform/common/cancellation';
import { getNotebookCellOutputMetadata } from '../../../kernels/execution/helpers';
import { unTrackDisplayDataForExtension } from '../../../kernels/execution/extensionDisplayDataTracker';
import { traceWarning } from '../../../platform/logging';
import { IBackgroundThreadService } from '../../../kernels/jupyter/types';
import { injectable } from 'inversify';

@injectable()
export class BackgroundThreadService implements IBackgroundThreadService {
    execCodeInBackgroundThread<T>(
        kernel: IKernel,
        codeWithReturnStatement: string[],
        token: CancellationToken
    ): Promise<T | undefined> {
        return execCodeInBackgroundThread(kernel, codeWithReturnStatement, token);
    }
}

export const executionCounters = new WeakMap<IKernel, number>();
export async function execCodeInBackgroundThread<T>(
    kernel: IKernel,
    codeWithReturnStatement: string[],
    token: CancellationToken
) {
    const counter = executionCounters.get(kernel) || 0;
    executionCounters.set(kernel, counter + 1);
    const api = createKernelApiForExtension(JVSC_EXTENSION_ID, kernel);
    const mime = `application/vnd.vscode.bg.execution.${counter}`;
    const mimeFinalResult = `application/vnd.vscode.bg.execution.${counter}.result`;
    const mimeErrorResult = `application/vnd.vscode.bg.execution.${counter}.error`;
    let displayId = '';

    const codeToSend = `
def __jupyter_exec_background__():
    from IPython.display import display
    from threading import Thread
    from traceback import format_exc

    # First send a dummy response to get the display id.
    # Later we'll send the real response with the actual data.
    # And that can happen much later even after the execution completes,
    # as that response will be sent from a bg thread.
    output = display({"${mime}": ""}, raw=True, display_id=True)

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
    const disposables = new DisposableStore();
    disposables.add(token.onCancellationRequested(() => disposables.dispose()));
    const promise = raceCancellation(
        token,
        new Promise<T | undefined>((resolve, reject) => {
            disposables.add(
                api.onDidReceiveDisplayUpdate(async (output) => {
                    if (token.isCancellationRequested) {
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
        // We no longer need to track any more outputs from the kernel that are related to this output.
    ).finally(() => {
        kernel.session && unTrackDisplayDataForExtension(kernel.session, displayId);
        disposables.dispose();
    });

    for await (const output of api.executeCode(codeToSend, token)) {
        if (token.isCancellationRequested) {
            return;
        }
        const metadata = getNotebookCellOutputMetadata(output);
        if (!metadata?.transient?.display_id) {
            continue;
        }
        const dummyMessage = output.items.find((item) => item.mime === mime);
        if (dummyMessage) {
            displayId = metadata.transient.display_id;
            continue;
        }

        if (displayId === metadata.transient.display_id) {
            const result = output.items.find((item) => item.mime === mimeFinalResult || item.mime === mimeErrorResult);
            if (result?.mime === mimeFinalResult) {
                return JSON.parse(new TextDecoder().decode(result.data)) as T;
            } else if (result?.mime === mimeErrorResult) {
                traceWarning('Error in background execution:\n', new TextDecoder().decode(result.data));
                return;
            }
        }
    }
    if (token.isCancellationRequested) {
        return;
    }
    if (!displayId) {
        traceWarning('Failed to get display id for completions');
        return;
    }

    return promise;
}
