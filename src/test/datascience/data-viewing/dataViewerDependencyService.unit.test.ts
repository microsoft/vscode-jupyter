// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import { SemVer } from 'semver';
import { instance, mock } from 'ts-mockito';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell } from '../../../platform/common/application/types';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { DataViewerDependencyService } from '../../../webviews/extension-side/dataviewer/dataViewerDependencyService';
import { Uri } from 'vscode';
import { IJupyterSession, IKernel, IKernelProvider } from '../../../kernels/types';
import { IShellFuture } from '@jupyterlab/services/lib/kernel/kernel';
import { IExecuteReplyMsg, IExecuteRequestMsg } from '@jupyterlab/services/lib/kernel/messages';
import { waitForCondition } from '../../common';
import { KernelMessage } from '@jupyterlab/services';

suite('DataScience - DataViewerDependencyService', () => {
    let interpreter: PythonEnvironment;
    let dependencyService: DataViewerDependencyService;
    let appShell: IApplicationShell;
    let kernelProvider: IKernelProvider;
    let kernel: IKernel;

    let sessionExecutionContext: KernelMessage.IExecuteRequestMsg['content'][];
    let shellFuture: IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;
    let jupyterSession: IJupyterSession = {
        requestExecute(context: KernelMessage.IExecuteRequestMsg['content']) {
            sessionExecutionContext.push(context);
            return shellFuture;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as IJupyterSession;

    setup(async () => {
        interpreter = {
            displayName: '',
            uri: Uri.file(path.join('users', 'python', 'bin', 'python.exe')),
            sysPrefix: '',
            sysVersion: '',
            version: new SemVer('3.3.3')
        };
        appShell = mock(ApplicationShell);
        kernelProvider = instance(mock<IKernelProvider>());
        kernel = instance(mock<IKernel>());
        sessionExecutionContext = [];

        dependencyService = new DataViewerDependencyService(instance(appShell), kernelProvider, false);
    });

    // TODO: Test if there are no idle kernels
    // TODO: Test if there's no kernel session

    test('All ok, if pandas is installed and version is > 1.20', async () => {
        // The output of the version, defined in this test, must be 3.3.3
        const version = '3.3.3';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = jupyterSession;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.status as any) = 'idle';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernelProvider.kernels as any) = [kernel];

        // Flow:
        //   checkAndInstallMissingDependencies ->
        //   private getVersionOfPandas -> executeSilently ->
        //   session.requestExecute -> request.onIOPub ->
        //   onIOPub(message) -> message.msgType === "stream"

        const onIOPubPromise = waitForCondition(
            () => Boolean(shellFuture.onIOPub),
            10000,
            'Timeout waiting for shellFuture.onIOPub'
        );
        shellFuture = {
            done: () => onIOPubPromise
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any as IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(interpreter);

        shellFuture.onIOPub(
            KernelMessage.createMessage<KernelMessage.IStreamMsg>({
                msgType: 'stream',
                channel: 'iopub',
                session: 'baz',
                content: {
                    name: 'stdout',
                    text: version
                }
            })
        );
        await onIOPubPromise;
        assert.equal(await resultPromise, undefined);

        assert.deepEqual(
            sessionExecutionContext.slice(-1)[0],
            {
                code: `import pandas; print(pandas.__version__)`,
                silent: false,
                stop_on_error: false,
                allow_stdin: true,
                store_history: false
            },
            'The kernel session did not receive a request to execute the code that prints the version of pandas'
        );
    });

    // test('Throw exception if pandas is installed and version is = 0.20', async () => {
    //     // Wait until onIOPub exists, send the message through.
    //     // The output of the version, defined in this test, must be 0.20
    //     // Must satisfy: {
    //     //     data: msg.content.data,
    //     //     execution_count: msg.content.execution_count,
    //     //     metadata: msg.content.metadata,
    //     //     output_type: 'execute_result'
    //     // };
    //     // Is there no `text`? We might need to change our code.
    //     const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);
    //
    //     await assert.isRejected(promise, DataScience.pandasTooOldForViewingFormat().format('0.20.'));
    // });
    // test('Throw exception if pandas is installed and version is < 0.20', async () => {
    //     // Wait until onIOPub exists, send the message through.
    //     // The output of the version, defined in this test, must be 0.10
    //     // Must satisfy: {
    //     //     data: msg.content.data,
    //     //     execution_count: msg.content.execution_count,
    //     //     metadata: msg.content.metadata,
    //     //     output_type: 'execute_result'
    //     // };
    //     // Is there no `text`? We might need to change our code.
    //
    //     const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);
    //
    //     await assert.isRejected(promise, DataScience.pandasTooOldForViewingFormat().format('0.10.'));
    // });
    // test('Prompt to install pandas and install pandas', async () => {
    //     when(
    //         pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
    //     ).thenReject(new Error('Not Found'));
    //     // eslint-disable-next-line @typescript-eslint/no-explicit-any
    //     when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve(Common.install() as any);
    //     when(installer.install(Product.pandas, interpreter, anything())).thenResolve();
    //
    //     await dependencyService.checkAndInstallMissingDependencies(interpreter);
    //
    //     verify(
    //         appShell.showErrorMessage(
    //             DataScience.pandasRequiredForViewing(),
    //             deepEqual({ modal: true }),
    //             Common.install()
    //         )
    //     ).once();
    //     verify(installer.install(Product.pandas, interpreter, anything())).once();
    // });
    // test('Prompt to install pandas and throw error if user does not install pandas', async () => {
    //     when(
    //         pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
    //     ).thenReject(new Error('Not Found'));
    //     when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve();
    //
    //     const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);
    //
    //     await assert.isRejected(promise, DataScience.pandasRequiredForViewing());
    //     verify(
    //         appShell.showErrorMessage(
    //             DataScience.pandasRequiredForViewing(),
    //             deepEqual({ modal: true }),
    //             Common.install()
    //         )
    //     ).once();
    //     verify(installer.install(anything(), anything(), anything())).never();
    // });
});
