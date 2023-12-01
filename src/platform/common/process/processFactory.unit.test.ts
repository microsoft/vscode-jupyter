// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { ProcessService } from '../../../platform/common/process/proc.node';
import { ProcessServiceFactory } from '../../../platform/common/process/processFactory.node';
import { IDisposable } from '../../../platform/common/types';
import { CustomEnvironmentVariablesProvider } from '../../../platform/common/variables/customEnvironmentVariablesProvider.node';
import { ICustomEnvironmentVariablesProvider } from '../../../platform/common/variables/types';
import { dispose, getDisposableTracker, setDisposableTracker } from '../utils/lifecycle';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';

suite('Process - ProcessServiceFactory', () => {
    let factory: ProcessServiceFactory;
    let envVariablesProvider: ICustomEnvironmentVariablesProvider;
    let disposableRegistry: IDisposable[] = [];
    let oldDisposable = getDisposableTracker();
    setup(() => {
        envVariablesProvider = mock(CustomEnvironmentVariablesProvider);
        when(mockedVSCodeNamespaces.workspace.isTrusted).thenReturn(true);
        factory = new ProcessServiceFactory(instance(envVariablesProvider));
        setDisposableTracker(disposableRegistry);
    });

    teardown(() => {
        setDisposableTracker(oldDisposable);
        disposableRegistry = dispose(disposableRegistry);
    });

    [Uri.parse('test'), undefined].forEach((resource) => {
        test(`Ensure ProcessService is created with an ${resource ? 'existing' : 'undefined'} resource`, async () => {
            when(envVariablesProvider.getEnvironmentVariables(resource, 'RunNonPythonCode', anything())).thenResolve({
                x: 'test'
            });

            const proc = await factory.create(resource);
            verify(envVariablesProvider.getEnvironmentVariables(resource, 'RunNonPythonCode', anything())).once();

            expect(disposableRegistry.length).equal(1);
            expect(proc).instanceOf(ProcessService);
        });
    });
});
