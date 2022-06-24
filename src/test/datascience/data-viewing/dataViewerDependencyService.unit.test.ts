// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell } from '../../../platform/common/application/types';
import { DataViewerDependencyService } from '../../../webviews/extension-side/dataviewer/dataViewerDependencyService';
import { IKernel } from '../../../kernels/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import * as helpers from '../../../kernels/helpers';
import * as sinon from 'sinon';

suite('DataScience - DataViewerDependencyService', () => {
    let dependencyService: DataViewerDependencyService;
    let appShell: IApplicationShell;
    let kernel: IKernel;

    setup(async () => {
        appShell = mock(ApplicationShell);
        kernel = instance(mock<IKernel>());
        dependencyService = new DataViewerDependencyService(instance(appShell), false);
    });

    teardown(() => {
        sinon.restore();
    });

    test('What if there are no kernel sessions?', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kernel.session as any) = undefined;

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);

        await assert.isRejected(
            resultPromise,
            DataScience.noActiveKernelSession(),
            'Failed to determine if there was an active kernel session'
        );
    });

    test('All ok, if pandas is installed and version is > 1.20', async () => {
        const version = '3.3.3';

        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: version }]));

        const result = await dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);
        assert.equal(result, undefined);
    });

    test('Throw exception if pandas is installed and version is = 0.20', async () => {
        const version = '0.20.0';

        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: version }]));

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);
        await assert.isRejected(
            resultPromise,
            DataScience.pandasTooOldForViewingFormat().format('0.20.'),
            'Failed to identify too old pandas'
        );
    });

    test('Throw exception if pandas is installed and version is < 0.20', async () => {
        const version = '0.10.0';

        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: version }]));

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);
        await assert.isRejected(
            resultPromise,
            DataScience.pandasTooOldForViewingFormat().format('0.10.'),
            'Failed to identify too old pandas'
        );
    });

    test('Prompt to install pandas, then install pandas', async () => {
        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: '' }]));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve(Common.install() as any);

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);
        assert.equal(await resultPromise, undefined);
    });

    test('Prompt to install pandas and throw error if user does not install pandas', async () => {
        const stub = sinon.stub(helpers, 'executeSilently');
        stub.returns(Promise.resolve([{ ename: 'stdout', output_type: 'stream', text: '' }]));

        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve();

        const resultPromise = dependencyService.checkAndInstallMissingDependenciesOnKernel(kernel);
        await assert.isRejected(resultPromise, DataScience.pandasRequiredForViewing());
    });
});
