// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { nbformat } from '@jupyterlab/coreutils';
import { assert, expect } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationToken } from 'vscode-jsonrpc';

import type { Kernel } from '@jupyterlab/services';
import { EventEmitter } from 'vscode';
import { PythonExtensionChecker } from '../../../../client/api/pythonApi';
import { ApplicationShell } from '../../../../client/common/application/applicationShell';
import { IApplicationShell } from '../../../../client/common/application/types';
import { ConfigurationService } from '../../../../client/common/configuration/service';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { IDisposable, IPathUtils, Resource } from '../../../../client/common/types';
import * as localize from '../../../../client/common/utils/localize';
import { noop } from '../../../../client/common/utils/misc';
import { StopWatch } from '../../../../client/common/utils/stopWatch';
import { JupyterSessionManager } from '../../../../client/datascience/jupyter/jupyterSessionManager';
import { JupyterSessionManagerFactory } from '../../../../client/datascience/jupyter/jupyterSessionManagerFactory';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { KernelSelectionProvider } from '../../../../client/datascience/jupyter/kernels/kernelSelections';
import { KernelSelector } from '../../../../client/datascience/jupyter/kernels/kernelSelector';
import { JupyterKernelService } from '../../../../client/datascience/jupyter/kernels/jupyterKernelService';
import { IKernelSpecQuickPickItem, KernelConnectionMetadata, LiveKernelModel } from '../../../../client/datascience/jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../../../../client/datascience/kernel-launcher/types';
import {
    IJupyterSessionManager,
    INotebookProviderConnection,
} from '../../../../client/datascience/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
import { PythonEnvironment } from '../../../../client/pythonEnvironments/info';
import { PreferredRemoteKernelIdProvider } from '../../../../client/datascience/notebookStorage/preferredRemoteKernelIdProvider';
import { disposeAllDisposables } from '../../../../client/common/helpers';
import { InterpreterPackages } from '../../../../client/datascience/telemetry/interpreterPackages';

/**
 * Given an active kernel, this will return a quick pick item with appropriate display names and the like.
 *
 * @param {(LiveKernelModel)} kernel
 * @param {IPathUtils} pathUtils
 * @returns {IKernelSpecQuickPickItem}
 */
 function getQuickPickItemForActiveKernel(
    kernel: LiveKernelModel,
    pathUtils: IPathUtils
): IKernelSpecQuickPickItem<KernelConnectionMetadata> {
    const pickPath = kernel.metadata?.interpreter?.path || kernel.path;
    return {
        label: kernel.display_name || kernel.name || '',
        // If we have a session, use that path
        detail: kernel.session.path || !pickPath ? kernel.session.path : pathUtils.getDisplayName(pickPath),
        description: localize.DataScience.jupyterSelectURIRunningDetailFormat().format(
            kernel.lastActivityTime.toLocaleString(),
            kernel.numberOfConnections.toString()
        ),
        selection: { kernelModel: kernel, interpreter: undefined, kind: 'connectToLiveKernel' }
    };
}

/* eslint-disable , @typescript-eslint/no-unused-expressions, @typescript-eslint/no-explicit-any */

suite('DataScience - KernelSelector', () => {
    let kernelSelectionProvider: KernelSelectionProvider;
    let kernelService: JupyterKernelService;
    let sessionManager: IJupyterSessionManager;
    let kernelSelector: KernelSelector;
    let interpreterService: IInterpreterService;
    let appShell: IApplicationShell;
    let dependencyService: KernelDependencyService;
    let kernelFinder: ILocalKernelFinder;
    let remoteFinder: IRemoteKernelFinder;
    let jupyterSessionManagerFactory: JupyterSessionManagerFactory;
    const kernelSpec = {
        argv: [],
        display_name: 'Something',
        dispose: async () => noop(),
        language: PYTHON_LANGUAGE,
        name: 'SomeName',
        path: 'somePath',
        env: {}
    };
    const interpreter: PythonEnvironment = {
        displayName: 'Something',
        path: 'somePath',
        sysPrefix: '',
        sysVersion: '',
        version: { raw: '3.7.1.1', major: 3, minor: 7, patch: 1, build: ['1'], prerelease: [] }
    };
    const kernelMetadata: KernelConnectionMetadata = {
        kind: 'startUsingPythonInterpreter',
        kernelSpec,
        interpreter
    }
    const disposableRegistry: IDisposable[] = [];
    setup(() => {
        sessionManager = mock(JupyterSessionManager);
        kernelService = mock(JupyterKernelService);
        kernelSelectionProvider = mock(KernelSelectionProvider);
        appShell = mock(ApplicationShell);
        dependencyService = mock(KernelDependencyService);
        when(dependencyService.installMissingDependencies(anything(), anything())).thenResolve();
        interpreterService = mock<IInterpreterService>();
        kernelFinder = mock<ILocalKernelFinder>();
        remoteFinder = mock<IRemoteKernelFinder>();
        jupyterSessionManagerFactory = mock(JupyterSessionManagerFactory);
        const dummySessionEvent = new EventEmitter<Kernel.IKernelConnection>();
        when(jupyterSessionManagerFactory.onRestartSessionCreated).thenReturn(dummySessionEvent.event);
        when(jupyterSessionManagerFactory.onRestartSessionUsed).thenReturn(dummySessionEvent.event);
        const configService = mock(ConfigurationService);
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        const preferredKernelIdProvider = mock(PreferredRemoteKernelIdProvider);
        when(preferredKernelIdProvider.getPreferredRemoteKernelId(anything())).thenResolve();
        when(preferredKernelIdProvider.storePreferredRemoteKernelId(anything(), anything())).thenResolve();
        kernelSelector = new KernelSelector(
            instance(kernelSelectionProvider),
            instance(appShell),
            instance(configService),
            instance(mock(InterpreterPackages))
        );
    });
    teardown(() => {
        sinon.restore();
        disposeAllDisposables(disposableRegistry);
    });
    suite('Select Remote Kernel', () => {
        test('Should display quick pick and return nothing when nothing is selected (remote sessions)', async () => {
            kernelSelector.askForLocalKernel
        });
        test('Should display quick pick and return nothing when nothing is selected (local sessions)', async () => {
        });
        test('Should return the selected remote kernelspec along with a matching interpreter', async () => {
        });
    });
    suite('Hide kernels from Remote & Local Kernel', () => {
        setup(() => {
            sinon.restore();
        });
        teardown(() => sinon.restore());
        test('Should hide kernel from remote sessions', async () => {
            const kernelModels: LiveKernelModel[] = [
                {
                    lastActivityTime: new Date(),
                    name: '1one',
                    numberOfConnections: 1,
                    id: 'id1',
                    display_name: '1',
                    session: {} as any
                },
                {
                    lastActivityTime: new Date(),
                    name: '2two',
                    numberOfConnections: 1,
                    id: 'id2',
                    display_name: '2',
                    session: {} as any
                },
                {
                    lastActivityTime: new Date(),
                    name: '3three',
                    numberOfConnections: 1,
                    id: 'id3',
                    display_name: '3',
                    session: {} as any
                },
                {
                    lastActivityTime: new Date(),
                    name: '4four',
                    numberOfConnections: 1,
                    id: 'id4',
                    display_name: '4',
                    session: {} as any
                }
            ];
            const pathUtils = mock<IPathUtils>();
            when(pathUtils.getDisplayName(anything())).thenCall((v) => v);
            const provider = new KernelSelectionProvider(instance(kernelFinder), instance(remoteFinder));
            const quickPickItems = kernelModels.map((item) =>
                getQuickPickItemForActiveKernel(item, instance(pathUtils))
            );
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve(undefined);
            const suggestions = await provider.getKernelSelections(undefined, undefined);

            assert.deepEqual(
                suggestions,
                quickPickItems.filter((item) => !['id2', 'id4'].includes((item.selection as any)?.kernelModel?.id || ''))
            );
        });
    });
    suite('Select Local Kernel', () => {
        test('Should return the selected local kernelspec along with a matching interpreter', async () => {
        });
        test('If selected interpreter has ipykernel installed, then return matching kernelspec and interpreter', async () => {
        });
        test('For a raw connection, if an interpreter is selected return it along with a default kernelspec', async () => {
        });
        test('For a raw connection, if a kernel spec is selected return it with the interpreter', async () => {
        });
    });
    // eslint-disable-next-line
    suite('Get a kernel for local sessions', () => {
        let nbMetadataKernelSpec: nbformat.IKernelspecMetadata = {} as any;
        let nbMetadata: nbformat.INotebookMetadata = {} as any;
        let selectLocalKernelStub: sinon.SinonStub<
            [Resource, StopWatch, INotebookProviderConnection | undefined, (CancellationToken | undefined)?, string?],
            Promise<any>
        >;
        setup(() => {
            nbMetadataKernelSpec = {
                display_name: interpreter.displayName!,
                name: kernelSpec.name
            };
            nbMetadata = {
                kernelspec: nbMetadataKernelSpec as any,
                orig_nbformat: 4,
                language_info: { name: PYTHON_LANGUAGE }
            };
            selectLocalKernelStub = sinon.stub(KernelSelector.prototype, 'selectLocalKernel');
            selectLocalKernelStub.resolves({ kernelSpec, interpreter });
        });
        teardown(() => sinon.restore());
        test('Raw kernel connection finds a valid kernel spec and interpreter', async () => {
        });
        test('If metadata contains kernel information, then return a matching kernel and a matching interpreter', async () => {
        });
        test('If metadata contains kernel information, then return a matching kernel', async () => {
        });
        test('If metadata contains kernel information, and there is matching kernelspec, then use current interpreter as a kernel', async () => {
        });
        test('If metadata is empty, then use active interpreter and find a kernel matching active interpreter', async () => {
        });
        test('Remote search works', async () => {
        });
        test('Remote search prefers same name as long as it is python', async () => {
        });
        test('Remote search prefers same version', async () => {
        });
    });
});
