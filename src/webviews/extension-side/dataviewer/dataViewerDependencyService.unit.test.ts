// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell } from '../../../platform/common/application/types';
import { DataViewerDependencyService } from './dataViewerDependencyService';
import { IKernel, IKernelSession } from '../../../kernels/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import * as helpers from '../../../kernels/helpers';
import * as sinon from 'sinon';
import { kernelGetPandasVersion } from './kernelDataViewerDependencyImplementation';
import { pandasMinimumVersionSupportedByVariableViewer } from './constants';
import { Kernel } from '@jupyterlab/services';

suite('DataViewerDependencyService (IKernel, Web)', () => {
    let dependencyService: DataViewerDependencyService;
    let appShell: IApplicationShell;
    let kernel: IKernel;
    let session: IKernelSession;

    setup(async () => {
        appShell = mock(ApplicationShell);
        session = mock<IKernelSession>();
        when(session.kernel).thenReturn(instance(mock<Kernel.IKernelConnection>()));
        kernel = mock<IKernel>();
        when(kernel.session).thenReturn(instance(session));
        dependencyService = new DataViewerDependencyService(instance(appShell), false);
    });

    teardown(() => {
        sinon.restore();
    });

    test('What if there are no kernel sessions?', async () => {
        when(kernel.session).thenReturn(undefined);

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(instance(kernel));

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

        const result = await dependencyService.checkAndInstallMissingDependencies(instance(kernel));
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

        const result = await dependencyService.checkAndInstallMissingDependencies(instance(kernel));
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

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(instance(kernel));
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

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(instance(kernel));
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

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(instance(kernel));
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

        const resultPromise = dependencyService.checkAndInstallMissingDependencies(instance(kernel));
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
