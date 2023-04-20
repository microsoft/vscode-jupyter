// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, Uri } from 'vscode';
import { IWorkspaceService } from '../../../platform/common/application/types';

import { ProcessService } from '../../../platform/common/process/proc.node';
import { ProcessServiceFactory } from '../../../platform/common/process/processFactory.node';
import { IDisposableRegistry } from '../../../platform/common/types';
import { CustomEnvironmentVariablesProvider } from '../../../platform/common/variables/customEnvironmentVariablesProvider.node';
import { ICustomEnvironmentVariablesProvider } from '../../../platform/common/variables/types';

suite('Process - ProcessServiceFactory', () => {
    let factory: ProcessServiceFactory;
    let envVariablesProvider: ICustomEnvironmentVariablesProvider;
    let disposableRegistry: IDisposableRegistry;

    setup(() => {
        envVariablesProvider = mock(CustomEnvironmentVariablesProvider);
        disposableRegistry = [];
        const workspace = mock<IWorkspaceService>();
        when(workspace.isTrusted).thenReturn(true);
        factory = new ProcessServiceFactory(instance(envVariablesProvider), disposableRegistry, instance(workspace));
    });

    teardown(() => {
        (disposableRegistry as Disposable[]).forEach((d) => d.dispose());
    });

    [Uri.parse('test'), undefined].forEach((resource) => {
        test(`Ensure ProcessService is created with an ${resource ? 'existing' : 'undefined'} resource`, async () => {
            when(envVariablesProvider.getEnvironmentVariables(resource, 'RunNonPythonCode', anything())).thenResolve({
                x: 'test'
            });

            const proc = await factory.create(resource);
            verify(envVariablesProvider.getEnvironmentVariables(resource, 'RunNonPythonCode', anything())).once();

            const disposables = disposableRegistry as Disposable[];
            expect(disposables.length).equal(1);
            expect(proc).instanceOf(ProcessService);
        });
    });
});
