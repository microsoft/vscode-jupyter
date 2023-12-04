// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { DataViewerDependencyService } from '../../../webviews/extension-side/dataviewer/dataViewerDependencyService.node';
import { IKernel, IKernelSession } from '../../../kernels/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import * as helpers from '../../../kernels/helpers';
import * as sinon from 'sinon';
import { kernelGetPandasVersion } from '../../../webviews/extension-side/dataviewer/kernelDataViewerDependencyImplementation';
import { IInstaller } from '../../../platform/interpreter/installer/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ProductInstaller } from '../../../platform/interpreter/installer/productInstaller.node';
import { pandasMinimumVersionSupportedByVariableViewer } from '../../../webviews/extension-side/dataviewer/constants';
import { PythonExecutionFactory } from '../../../platform/interpreter/pythonExecutionFactory.node';
import { IPythonExecutionFactory } from '../../../platform/interpreter/types.node';
import { Kernel } from '@jupyterlab/services';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../test/vscode-mock';

suite('DataViewerDependencyService (IKernel, Node)', () => {
    let dependencyService: DataViewerDependencyService;
    let pythonExecFactory: IPythonExecutionFactory;
    let installer: IInstaller;
    let interpreterService: IInterpreterService;
    let kernel: IKernel;
    let session: IKernelSession;

    setup(async () => {
        resetVSCodeMocks();
        installer = mock(ProductInstaller);
        pythonExecFactory = mock(PythonExecutionFactory);
        interpreterService = mock<IInterpreterService>();
        kernel = mock<IKernel>();
        session = mock<IKernelSession>();
        when(session.kernel).thenReturn(instance(mock<Kernel.IKernelConnection>()));
        when(kernel.session).thenReturn(instance(session));

        dependencyService = new DataViewerDependencyService(
            instance(installer),
            instance(pythonExecFactory),
            instance(interpreterService)
        );
    });

    teardown(() => {
        resetVSCodeMocks();
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
        when(mockedVSCodeNamespaces.window.showErrorMessage(anything(), anything(), anything())).thenResolve(
            Common.install as any
        );

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

        when(mockedVSCodeNamespaces.window.showErrorMessage(anything(), anything(), anything())).thenResolve();

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
