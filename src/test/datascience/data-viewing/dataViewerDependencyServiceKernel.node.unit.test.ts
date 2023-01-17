// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell } from '../../../platform/common/application/types';
import { DataViewerDependencyService } from '../../../webviews/extension-side/dataviewer/dataViewerDependencyService.node';
import { IKernel } from '../../../kernels/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import * as helpers from '../../../kernels/helpers';
import * as sinon from 'sinon';
import { kernelGetPandasVersion } from '../../../webviews/extension-side/dataviewer/kernelDataViewerDependencyImplementation';
import { IPythonExecutionFactory } from '../../../platform/common/process/types.node';
import { IInstaller } from '../../../kernels/installer/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ProductInstaller } from '../../../kernels/installer/productInstaller.node';
import { PythonExecutionFactory } from '../../../platform/common/process/pythonExecutionFactory.node';
import { pandasMinimumVersionSupportedByVariableViewer } from '../../../webviews/extension-side/dataviewer/constants';

suite('DataViewerDependencyService (IKernel, Node)', () => {
    let dependencyService: DataViewerDependencyService;
    let appShell: IApplicationShell;
    let pythonExecFactory: IPythonExecutionFactory;
    let installer: IInstaller;
    let interpreterService: IInterpreterService;
    let kernel: IKernel;

    setup(async () => {
        installer = mock(ProductInstaller);
        appShell = mock(ApplicationShell);
        pythonExecFactory = mock(PythonExecutionFactory);
        interpreterService = mock<IInterpreterService>();
        kernel = instance(mock<IKernel>());

        dependencyService = new DataViewerDependencyService(
            instance(installer),
            instance(pythonExecFactory),
            instance(interpreterService),
            instance(appShell),
            false
        );
    });

    teardown(() => {
        sinon.restore();
    });

    test('What if there are no kernel sessions?', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = undefined;

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(kernel);

        await assert.isRejected(
            resultPromise,
            'No no active kernel session.',
            'Failed to determine if there was an active kernel session'
        );
    });

    test('All ok, if pandas is installed and version is > 1.20', async () => {
        const version = '3.3.3';

        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: version }]));

        const result = await dependencyService.checkAndInstallMissingDependencies(kernel);
        assert.equal(result, undefined);
        assert.deepEqual(
            stub.getCalls().map((call) => call.lastArg),
            [kernelGetPandasVersion]
        );
    });

    test('All ok, if pandas is installed and version is > 1.20, even if the command returns with a new line', async () => {
        const version = '1.4.2\n';

        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: version }]));

        const result = await dependencyService.checkAndInstallMissingDependencies(kernel);
        assert.equal(result, undefined);
        assert.deepEqual(
            stub.getCalls().map((call) => call.lastArg),
            [kernelGetPandasVersion]
        );
    });

    test('Throw exception if pandas is installed and version is = 0.20', async () => {
        const version = '0.20.0';

        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: version }]));

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(kernel);
        await assert.isRejected(
            resultPromise,
            DataScience.pandasTooOldForViewingFormat('0.20.', pandasMinimumVersionSupportedByVariableViewer),
            'Failed to identify too old pandas'
        );
        assert.deepEqual(
            stub.getCalls().map((call) => call.lastArg),
            [kernelGetPandasVersion]
        );
    });

    test('Throw exception if pandas is installed and version is < 0.20', async () => {
        const version = '0.10.0';

        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: version }]));

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(kernel);
        await assert.isRejected(
            resultPromise,
            DataScience.pandasTooOldForViewingFormat('0.10.', pandasMinimumVersionSupportedByVariableViewer),
            'Failed to identify too old pandas'
        );
        assert.deepEqual(
            stub.getCalls().map((call) => call.lastArg),
            [kernelGetPandasVersion]
        );
    });

    test('Prompt to install pandas, then install pandas', async () => {
        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: '' }]));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve(Common.install as any);

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(kernel);
        assert.equal(await resultPromise, undefined);
        assert.deepEqual(
            stub.getCalls().map((call) => call.lastArg),
            [kernelGetPandasVersion, '%pip install pandas']
        );
    });

    test('Prompt to install pandas and throw error if user does not install pandas', async () => {
        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: '' }]));

        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve();

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(kernel);
        await assert.isRejected(
            resultPromise,
            DataScience.pandasRequiredForViewing(pandasMinimumVersionSupportedByVariableViewer)
        );
        assert.deepEqual(
            stub.getCalls().map((call) => call.lastArg),
            [kernelGetPandasVersion]
        );
    });
});
