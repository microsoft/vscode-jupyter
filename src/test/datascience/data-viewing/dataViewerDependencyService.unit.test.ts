// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as path from 'path';
import { SemVer } from 'semver';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { ApplicationShell } from '../../../client/common/application/applicationShell';
import { IApplicationShell } from '../../../client/common/application/types';
import { ProductInstaller } from '../../../client/common/installer/productInstaller';
import { PythonExecutionFactory } from '../../../client/common/process/pythonExecutionFactory';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../client/common/process/types';
import { IInstaller, Product } from '../../../client/common/types';
import { Common, DataScience } from '../../../client/common/utils/localize';
import { DataViewerDependencyService } from '../../../client/datascience/data-viewing/dataViewerDependencyService';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { InterpreterService } from '../../interpreters/interpreterService';

suite('DataScience - DataViewerDependencyService', () => {
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
            path: path.join('users', 'python', 'bin', 'python.exe'),
            sysPrefix: '',
            sysVersion: '',
            version: new SemVer('3.3.3')
        };
        pythonExecService = mock<IPythonExecutionService>();
        installer = mock(ProductInstaller);
        appShell = mock(ApplicationShell);
        pythonExecFactory = mock(PythonExecutionFactory);
        interpreterService = mock(InterpreterService);

        dependencyService = new DataViewerDependencyService(
            instance(appShell),
            instance(installer),
            instance(pythonExecFactory),
            instance(interpreterService)
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

        await assert.isRejected(promise, DataScience.pandasTooOldForViewingFormat().format('0.20.'));
    });
    test('Throw exception if pandas is installed and version is < 0.20', async () => {
        when(
            pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
        ).thenResolve({ stdout: '0.10.0' });

        const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);

        await assert.isRejected(promise, DataScience.pandasTooOldForViewingFormat().format('0.10.'));
    });
    test('Prompt to install pandas and install pandas', async () => {
        when(
            pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
        ).thenReject(new Error('Not Found'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showErrorMessage(anything(), anything())).thenResolve(Common.install() as any);
        when(installer.install(Product.pandas, interpreter, anything())).thenResolve();

        await dependencyService.checkAndInstallMissingDependencies(interpreter);

        verify(appShell.showErrorMessage(DataScience.pandasRequiredForViewing(), Common.install())).once();
        verify(installer.install(Product.pandas, interpreter, anything())).once();
    });
    test('Prompt to install pandas and throw error if user does not install pandas', async () => {
        when(
            pythonExecService.exec(deepEqual(['-c', 'import pandas;print(pandas.__version__)']), anything())
        ).thenReject(new Error('Not Found'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showErrorMessage(anything(), anything())).thenResolve();

        const promise = dependencyService.checkAndInstallMissingDependencies(interpreter);

        await assert.isRejected(promise, DataScience.pandasRequiredForViewing());
        verify(appShell.showErrorMessage(DataScience.pandasRequiredForViewing(), Common.install())).once();
        verify(installer.install(anything(), anything(), anything())).never();
    });
});
