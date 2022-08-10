// Copyright (c) Microsoft Corporation.
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
import { pandasMinimumVersionSupportedByVariableViewer } from '../../../webviews/extension-side/dataviewer/constants';

suite('DataScience - DataViewerDependencyService (PythonEnvironment, Node)', () => {
    let dependencyService: DataViewerDependencyService;
    let appShell: IApplicationShell;
    let pythonExecFactory: IPythonExecutionFactory;
    let installer: IInstaller;
    let interpreter: PythonEnvironment;
    let interpreterService: IInterpreterService;
    let pythonExecService: IPythonExecutionService;

    setup(async () => {
        interpreter = {
            displayName: '',
            uri: Uri.file(path.join('users', 'python', 'bin', 'python.exe')),
            sysPrefix: '',
            sysVersion: '',
            version: new SemVer('3.3.3')
        };
        pythonExecService = mock<IPythonExecutionService>();
        installer = mock(ProductInstaller);
        appShell = mock(ApplicationShell);
        pythonExecFactory = mock(PythonExecutionFactory);
        interpreterService = mock<IInterpreterService>();

        dependencyService = new DataViewerDependencyService(
            instance(installer),
            instance(pythonExecFactory),
            instance(interpreterService),
            instance(appShell),
            false
        );

        when(interpreterService.getActiveInterpreter()).thenResolve(interpreter);
        when(interpreterService.getActiveInterpreter(anything())).thenResolve(interpreter);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (instance(pythonExecService) as any).then = undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pythonExecService as any).then = undefined;
        when(pythonExecFactory.createActivatedEnvironment(anything())).thenResolve(instance(pythonExecService));
    });
    test('All ok, if pandas is installed and version is > 1.20', async () => {
        when(
            pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
        ).thenResolve({ stdout: '0.30.0' });
        await dependencyService.checkAndInstallMissingDependencies(interpreter);
    });
    test('Throw exception if pandas is installed and version is = 0.20', async () => {
        when(
            pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
        ).thenResolve({ stdout: '0.20.0' });

        const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);

        await assert.isRejected(
            promise,
            DataScience.pandasTooOldForViewingFormat().format('0.20.', pandasMinimumVersionSupportedByVariableViewer)
        );
    });
    test('Throw exception if pandas is installed and version is < 0.20', async () => {
        when(
            pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
        ).thenResolve({ stdout: '0.10.0' });

        const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);

        await assert.isRejected(
            promise,
            DataScience.pandasTooOldForViewingFormat().format('0.10.', pandasMinimumVersionSupportedByVariableViewer)
        );
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
                DataScience.pandasRequiredForViewing().format(pandasMinimumVersionSupportedByVariableViewer),
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

        await assert.isRejected(
            promise,
            DataScience.pandasRequiredForViewing().format(pandasMinimumVersionSupportedByVariableViewer)
        );
        verify(
            appShell.showErrorMessage(
                DataScience.pandasRequiredForViewing().format(pandasMinimumVersionSupportedByVariableViewer),
                deepEqual({ modal: true }),
                Common.install()
            )
        ).once();
        verify(installer.install(anything(), anything(), anything())).never();
    });
});
