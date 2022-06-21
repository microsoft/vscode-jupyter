// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import { SemVer } from 'semver';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell } from '../../../platform/common/application/types';
import { PythonExecutionFactory } from '../../../platform/common/process/pythonExecutionFactory.node';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../platform/common/process/types.node';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { ProductInstaller } from '../../../kernels/installer/productInstaller.node';
import { IInstaller, Product } from '../../../kernels/installer/types';
import { DataViewerDependencyService } from '../../../webviews/extension-side/dataviewer/dataViewerDependencyService.node';
import { Uri } from 'vscode';
import { IKernel, IKernelProvider } from '../../../kernels/types';
import { NotebookEditorProvider } from '../../../notebooks/notebookEditorProvider';
import { request } from 'http';
import { IShellFuture } from '@jupyterlab/services/lib/kernel/kernel';
import { IExecuteReplyMsg, IExecuteRequestMsg } from '@jupyterlab/services/lib/kernel/messages';

suite('DataScience - DataViewerDependencyService', () => {
    let interpreter: PythonEnvironment;
    let dependencyService: DataViewerDependencyService;
    let appShell: IApplicationShell;
    let kernelProvider: IKernelProvider;
    let kernel: IKernel;
    let notebookEditorProvider: NotebookEditorProvider;
    let sessionValues = {
        onIOPub: {
            message: 'execute_result'
        },
        done: false
    };
    setup(async () => {
        interpreter = {
            displayName: '',
            uri: Uri.file(path.join('users', 'python', 'bin', 'python.exe')),
            sysPrefix: '',
            sysVersion: '',
            version: new SemVer('3.3.3')
        };
        appShell = mock(ApplicationShell);
        kernelProvider = mock<IKernelProvider>();
        kernel = mock<IKernel>();
        notebookEditorProvider = mock(NotebookEditorProvider);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = {
            requestExecute() {
                return {
                    done: () => sessionValues.done
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any as IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;
            }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (notebookEditorProvider.activeNotebookEditor as any) = {
            notebook: {
                uri: Uri.file('test.ipynb')
            }
        };
        when(kernelProvider.get).thenReturn(() => kernel);

        dependencyService = new DataViewerDependencyService(
            instance(appShell),
            instance(kernelProvider),
            instance(notebookEditorProvider),
            false
        );
    });
    test('All ok, if pandas is installed and version is > 1.20', async () => {
        // Wait until onIOPub exists, send the message through.
        // The output of the version, defined in this test, must be 3.3.3
        // Must satisfy: {
        //     data: msg.content.data,
        //     execution_count: msg.content.execution_count,
        //     metadata: msg.content.metadata,
        //     output_type: 'execute_result'
        // };
        // Is there no `text`? We might need to change our code.
        const result = await dependencyService.checkAndInstallMissingDependencies(interpreter);
        // Result should be undefined.
    });
    test('Throw exception if pandas is installed and version is = 0.20', async () => {
        // Wait until onIOPub exists, send the message through.
        // The output of the version, defined in this test, must be 0.20
        // Must satisfy: {
        //     data: msg.content.data,
        //     execution_count: msg.content.execution_count,
        //     metadata: msg.content.metadata,
        //     output_type: 'execute_result'
        // };
        // Is there no `text`? We might need to change our code.
        const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);

        await assert.isRejected(promise, DataScience.pandasTooOldForViewingFormat().format('0.20.'));
    });
    test('Throw exception if pandas is installed and version is < 0.20', async () => {
        // Wait until onIOPub exists, send the message through.
        // The output of the version, defined in this test, must be 0.10
        // Must satisfy: {
        //     data: msg.content.data,
        //     execution_count: msg.content.execution_count,
        //     metadata: msg.content.metadata,
        //     output_type: 'execute_result'
        // };
        // Is there no `text`? We might need to change our code.

        const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);

        await assert.isRejected(promise, DataScience.pandasTooOldForViewingFormat().format('0.10.'));
    });
    test('Prompt to install pandas and install pandas', async () => {
        when(
            pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
        ).thenReject(new Error('Not Found'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve(Common.install() as any);
        when(installer.install(Product.pandas, interpreter, anything())).thenResolve();

        await dependencyService.checkAndInstallMissingDependencies(interpreter);

        verify(
            appShell.showErrorMessage(
                DataScience.pandasRequiredForViewing(),
                deepEqual({ modal: true }),
                Common.install()
            )
        ).once();
        verify(installer.install(Product.pandas, interpreter, anything())).once();
    });
    test('Prompt to install pandas and throw error if user does not install pandas', async () => {
        when(
            pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
        ).thenReject(new Error('Not Found'));
        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve();

        const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);

        await assert.isRejected(promise, DataScience.pandasRequiredForViewing());
        verify(
            appShell.showErrorMessage(
                DataScience.pandasRequiredForViewing(),
                deepEqual({ modal: true }),
                Common.install()
            )
        ).once();
        verify(installer.install(anything(), anything(), anything())).never();
    });
});
