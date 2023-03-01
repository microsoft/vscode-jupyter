// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { instance, mock, verify, when } from 'ts-mockito';
import { Disposable, Uri } from 'vscode';
import { IWorkspaceService } from '../../../platform/common/application/types';

import { ProcessLogger } from '../../../platform/common/process/logger.node';
import { ProcessService } from '../../../platform/common/process/proc.node';
import { ProcessServiceFactory } from '../../../platform/common/process/processFactory.node';
import { IProcessLogger } from '../../../platform/common/process/types.node';
import { IDisposableRegistry } from '../../../platform/common/types';
import { CustomEnvironmentVariablesProvider } from '../../../platform/common/variables/customEnvironmentVariablesProvider.node';
import { ICustomEnvironmentVariablesProvider } from '../../../platform/common/variables/types';

suite('Process - ProcessServiceFactory', () => {
    let factory: ProcessServiceFactory;
    let envVariablesProvider: ICustomEnvironmentVariablesProvider;
    let processLogger: IProcessLogger;
    let processService: ProcessService;
    let disposableRegistry: IDisposableRegistry;

    setup(() => {
        envVariablesProvider = mock(CustomEnvironmentVariablesProvider);
        processLogger = mock(ProcessLogger);
        when(processLogger.logProcess('', [], {})).thenReturn();
        processService = mock(ProcessService);
        when(
            processService.on('exec', () => {
                return;
            })
        ).thenReturn(processService);
        disposableRegistry = [];
        const workspace = mock<IWorkspaceService>();
        when(workspace.isTrusted).thenReturn(true);
        factory = new ProcessServiceFactory(
            instance(envVariablesProvider),
            instance(processLogger),
            disposableRegistry,
            instance(workspace)
        );
    });

    teardown(() => {
        (disposableRegistry as Disposable[]).forEach((d) => d.dispose());
    });

    [Uri.parse('test'), undefined].forEach((resource) => {
        test(`Ensure ProcessService is created with an ${resource ? 'existing' : 'undefined'} resource`, async () => {
            when(envVariablesProvider.getEnvironmentVariables(resource, 'RunNonPythonCode')).thenResolve({ x: 'test' });

            const proc = await factory.create(resource);
            verify(envVariablesProvider.getEnvironmentVariables(resource, 'RunNonPythonCode')).once();

            const disposables = disposableRegistry as Disposable[];
            expect(disposables.length).equal(1);
            expect(proc).instanceOf(ProcessService);
        });
    });
});
