// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell } from '../../../platform/common/application/types';
import { DataViewerDependencyService } from '../../../webviews/extension-side/dataviewer/dataViewerDependencyService';
import { IJupyterSession, IKernel } from '../../../kernels/types';
import { IShellFuture } from '@jupyterlab/services/lib/kernel/kernel';
import { IExecuteReplyMsg, IExecuteRequestMsg } from '@jupyterlab/services/lib/kernel/messages';
import { waitForCondition } from '../../common';
import { KernelMessage } from '@jupyterlab/services';
import { Common, DataScience } from '../../../platform/common/utils/localize';

suite('DataScience - DataViewerDependencyService', () => {
    let dependencyService: DataViewerDependencyService;
    let appShell: IApplicationShell;
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

    const expectedPandasVersionExecutionContext = {
        code: `import pandas; print(pandas.__version__)`,
        silent: false,
        stop_on_error: false,
        allow_stdin: true,
        store_history: false
    };
    const expectedInstallPandasExecutionContext = {
        code: `pip install pandas`,
        silent: false,
        stop_on_error: false,
        allow_stdin: true,
        store_history: false
    };

    setup(async () => {
        appShell = mock(ApplicationShell);
        kernel = instance(mock<IKernel>());
        sessionExecutionContext = [];

        dependencyService = new DataViewerDependencyService(instance(appShell), false);
    });

    test('What happens if there are no idle kernels?', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = jupyterSession;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.status as any) = 'busy';

        shellFuture = {
            done: () => Promise.resolve()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any as IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);

        await assert.isRejected(
            resultPromise,
            DataScience.noIdleKernel(),
            'Failed to determine if there was an idle kernel'
        );
    });

    test('What if there are no kernel sessions?', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.status as any) = 'idle';

        shellFuture = {
            done: () => Promise.resolve()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any as IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);

        await assert.isRejected(
            resultPromise,
            DataScience.noActiveKernelSession(),
            'Failed to determine if there was an active kernel session'
        );
    });

    test('All ok, if pandas is installed and version is > 1.20', async () => {
        const version = '3.3.3';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = jupyterSession;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.status as any) = 'idle';

        // Execution flow:
        //   checkAndInstallMissingDependenciesOnKernel
        // private getVersionOfPandas -> executeSilently ->
        //   session.requestExecute -> request.onIOPub ->
        //   onIOPub(message) -> message.msgType === "stream"

        const onIOPubPromise = waitForCondition(
            () => Boolean(shellFuture.onIOPub),
            1000,
            'Timeout waiting for shellFuture.onIOPub'
        );
        shellFuture = {
            done: () => onIOPubPromise
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any as IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
            expectedPandasVersionExecutionContext,
            'The kernel session did not receive a request to execute the code that prints the version of pandas'
        );
    });

    test('Throw exception if pandas is installed and version is = 0.20', async () => {
        const version = '0.20.0';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = jupyterSession;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.status as any) = 'idle';

        // Execution flow:
        //   checkAndInstallMissingDependenciesOnKernel
        // private getVersionOfPandas -> executeSilently ->
        //   session.requestExecute -> request.onIOPub ->
        //   onIOPub(message) -> message.msgType === "stream"

        const onIOPubPromise = waitForCondition(
            () => Boolean(shellFuture.onIOPub),
            1000,
            'Timeout waiting for shellFuture.onIOPub'
        );

        shellFuture = {
            done: () => onIOPubPromise
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any as IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
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

        await assert.isRejected(
            resultPromise,
            DataScience.pandasTooOldForViewingFormat().format('0.20.'),
            'Failed to identify too old pandas'
        );

        assert.deepEqual(
            sessionExecutionContext.slice(-1)[0],
            expectedPandasVersionExecutionContext,
            'The kernel session did not receive a request to execute the code that prints the version of pandas'
        );
    });

    test('Throw exception if pandas is installed and version is < 0.20', async () => {
        const version = '0.10.0';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = jupyterSession;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.status as any) = 'idle';

        // Execution flow:
        //   checkAndInstallMissingDependenciesOnKernel
        // private getVersionOfPandas -> executeSilently ->
        //   session.requestExecute -> request.onIOPub ->
        //   onIOPub(message) -> message.msgType === "stream"

        const onIOPubPromise = waitForCondition(
            () => Boolean(shellFuture.onIOPub),
            1000,
            'Timeout waiting for shellFuture.onIOPub'
        );

        shellFuture = {
            done: () => onIOPubPromise
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any as IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
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

        await assert.isRejected(
            resultPromise,
            DataScience.pandasTooOldForViewingFormat().format('0.10.'),
            'Failed to identify too old pandas'
        );

        assert.deepEqual(
            sessionExecutionContext.slice(-1)[0],
            expectedPandasVersionExecutionContext,
            'The kernel session did not receive a request to execute the code that prints the version of pandas'
        );
    });

    test('Prompt to install pandas and install pandas', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = jupyterSession;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.status as any) = 'idle';

        const onIOPubPromise = waitForCondition(
            () => Boolean(shellFuture.onIOPub),
            1000,
            'Timeout waiting for shellFuture.onIOPub'
        );
        shellFuture = {
            done: () => onIOPubPromise
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any as IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve(Common.install() as any);

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        shellFuture.onIOPub(
            KernelMessage.createMessage<KernelMessage.IErrorMsg>({
                msgType: 'error',
                channel: 'iopub',
                session: 'baz',
                content: {
                    ename: 'ModuleNotFoundError',
                    evalue: `No module named 'pandas'`,
                    traceback: [
                        `[0;31m---------------------------------------------------------------------------[0m`,
                        `[0;31mModuleNotFoundError[0m                       Traceback (most recent call last)`,
                        `[0;32mUntitled-2[0m in [0;36m<module>[0;34m[0m\n[0;32m----> 1[0;31m [0;32mimport[0m [0mpandas[0m[0;34m;[0m [0mprint[0m[0;34m([0m[0mpandas[0m[0;34m.[0m[0m__version__[0m[0;34m)[0m[0;34m[0m[0;34m[0m[0m\n[0m`,
                        `[0;31mModuleNotFoundError[0m: No module named 'pandas`
                    ]
                }
            })
        );

        await onIOPubPromise;

        assert.deepEqual(
            sessionExecutionContext,
            [expectedPandasVersionExecutionContext, expectedInstallPandasExecutionContext],
            'The kernel session did not receive a request to execute the code that prints the version of pandas'
        );

        await waitForCondition(
            async () => sessionExecutionContext.slice(-1)[0].code.indexOf('install pandas') > -1,
            1000,
            'Timeout waiting for install pandas'
        );

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        shellFuture.onIOPub(
            // IMPORTANT: This is not the real output of the installation of Pandas.
            // Pandas' installation occurs in a larger number of outputs.
            // checkAndInstallMissingDependenciesOnKernel lyooks for errors to determine it failed or not, not for the actual output.
            KernelMessage.createMessage<KernelMessage.IStreamMsg>({
                msgType: 'stream',
                channel: 'iopub',
                session: 'baz',
                content: {
                    name: 'stdout',
                    text: 'Fake installation output'
                }
            })
        );

        assert.equal(await resultPromise, undefined);
    });

    test('Prompt to install pandas and throw error if user does not install pandas', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = jupyterSession;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.status as any) = 'idle';

        const onIOPubPromise = waitForCondition(
            () => Boolean(shellFuture.onIOPub),
            1000,
            'Timeout waiting for shellFuture.onIOPub'
        );
        shellFuture = {
            done: () => onIOPubPromise
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any as IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);

        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve();

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        shellFuture.onIOPub(
            KernelMessage.createMessage<KernelMessage.IErrorMsg>({
                msgType: 'error',
                channel: 'iopub',
                session: 'baz',
                content: {
                    ename: 'ModuleNotFoundError',
                    evalue: `No module named 'pandas'`,
                    traceback: [
                        // NOTE: This is not the real output of the installation of Pandas. The real output has some extra characters that look pretty bad here.
                        `[0;31m---------------------------------------------------------------------------[0m`,
                        `[0;31mModuleNotFoundError[0m                       Traceback (most recent call last)`,
                        `[0;32mUntitled-2[0m in [0;36m<module>[0;34m[0m\n[0;32m----> 1[0;31m [0;32mimport[0m [0mpandas[0m[0;34m;[0m [0mprint[0m[0;34m([0m[0mpandas[0m[0;34m.[0m[0m__version__[0m[0;34m)[0m[0;34m[0m[0;34m[0m[0m\n[0m`,
                        `[0;31mModuleNotFoundError[0m: No module named 'pandas`
                    ]
                }
            })
        );

        await onIOPubPromise;

        assert.deepEqual(
            sessionExecutionContext,
            [expectedPandasVersionExecutionContext],
            'The kernel session did not receive a request to execute the code that prints the version of pandas'
        );

        await assert.isRejected(resultPromise, DataScience.pandasRequiredForViewing());
    });
});
