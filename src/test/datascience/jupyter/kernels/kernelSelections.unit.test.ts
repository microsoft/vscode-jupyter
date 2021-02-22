// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { Kernel } from '@jupyterlab/services';
import { assert } from 'chai';
import { teardown } from 'mocha';
import { anything, instance, mock, when } from 'ts-mockito';
import { EventEmitter } from 'vscode';
import { PythonExtensionChecker } from '../../../../client/api/pythonApi';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { disposeAllDisposables } from '../../../../client/common/helpers';
import { PathUtils } from '../../../../client/common/platform/pathUtils';
import { IDisposable, IPathUtils } from '../../../../client/common/types';
import * as localize from '../../../../client/common/utils/localize';
import { JupyterSessionManager } from '../../../../client/datascience/jupyter/jupyterSessionManager';
import { JupyterSessionManagerFactory } from '../../../../client/datascience/jupyter/jupyterSessionManagerFactory';
import { KernelSelectionProvider } from '../../../../client/datascience/jupyter/kernels/kernelSelections';
import { KernelService } from '../../../../client/datascience/jupyter/kernels/kernelService';
import {
    IKernelSpecQuickPickItem,
    KernelConnectionMetadata,
    KernelSpecConnectionMetadata
} from '../../../../client/datascience/jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../../../../client/datascience/kernel-launcher/types';
import {
    IJupyterKernel,
    IJupyterKernelSpec,
    IJupyterSessionManager,
    IRawNotebookSupportedService
} from '../../../../client/datascience/types';
import { IInterpreterQuickPickItem, IInterpreterSelector } from '../../../../client/interpreter/configuration/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';

// eslint-disable-next-line
suite('DataScience - KernelSelections', () => {
    let kernelSelectionProvider: KernelSelectionProvider;
    let kernelService: KernelService;
    let kernelFinder: ILocalKernelFinder;
    let remoteKernelFinder: IRemoteKernelFinder;
    let interpreterSelector: IInterpreterSelector;
    let pathUtils: IPathUtils;
    let sessionManager: IJupyterSessionManager;
    const activePython1KernelModel = {
        lastActivityTime: new Date(2011, 11, 10, 12, 15, 0, 0),
        numberOfConnections: 10,
        name: 'py1'
    };
    const activeJuliaKernelModel = {
        lastActivityTime: new Date(2001, 1, 1, 12, 15, 0, 0),
        numberOfConnections: 10,
        name: 'julia'
    };
    const python1KernelSpecModel = {
        argv: [],
        display_name: 'Python display name',
        language: PYTHON_LANGUAGE,
        name: 'py1',
        path: 'somePath',
        metadata: {},
        env: {}
    };
    const python3KernelSpecModel = {
        argv: [],
        display_name: 'Python3',
        language: PYTHON_LANGUAGE,
        name: 'py3',
        path: 'somePath3',
        metadata: {},
        env: {}
    };
    const juliaKernelSpecModel = {
        argv: [],
        display_name: 'Julia display name',
        language: 'julia',
        name: 'julia',
        path: 'j',
        metadata: {},
        env: {}
    };
    const rKernelSpecModel = {
        argv: [],
        display_name: 'R',
        language: 'r',
        name: 'r',
        path: 'r',
        metadata: {},
        env: {}
    };

    const allSpecs: IJupyterKernelSpec[] = [
        python1KernelSpecModel,
        python3KernelSpecModel,
        juliaKernelSpecModel,
        rKernelSpecModel
    ];

    const allMetadata: KernelConnectionMetadata[] = allSpecs.map((s) => {
        const result: KernelSpecConnectionMetadata = {
            kind: 'startUsingKernelSpec',
            kernelSpec: s
        };
        return result;
    });

    const allInterpreters: IInterpreterQuickPickItem[] = [
        {
            label: 'Hello1',
            interpreter: {
                path: 'p1',
                sysPrefix: '',
                sysVersion: '',
                displayName: 'Hello1'
            },
            path: 'p1',
            detail: '<user friendly path>',
            description: ''
        },
        {
            label: 'Hello1',
            interpreter: {
                path: 'p2',
                sysPrefix: '',
                sysVersion: '',
                displayName: 'Hello2'
            },
            path: 'p1',
            detail: '<user friendly path>',
            description: ''
        },
        {
            label: 'Hello1',
            interpreter: {
                path: 'p3',
                sysPrefix: '',
                sysVersion: '',
                displayName: 'Hello3'
            },
            path: 'p1',
            detail: '<user friendly path>',
            description: ''
        }
    ];
    const disposableRegistry: IDisposable[] = [];
    setup(() => {
        interpreterSelector = mock<IInterpreterSelector>();
        sessionManager = mock(JupyterSessionManager);
        const jupyterSessionManagerFactory = mock(JupyterSessionManagerFactory);
        when(jupyterSessionManagerFactory.create(anything())).thenResolve(instance(sessionManager));
        when(jupyterSessionManagerFactory.create(anything(), anything())).thenResolve(instance(sessionManager));
        const eventEmitter = new EventEmitter<Kernel.IKernelConnection>();
        disposableRegistry.push(eventEmitter);
        when(jupyterSessionManagerFactory.onRestartSessionCreated).thenReturn(eventEmitter.event);
        when(jupyterSessionManagerFactory.onRestartSessionUsed).thenReturn(eventEmitter.event);
        kernelService = mock(KernelService);
        kernelFinder = mock<ILocalKernelFinder>();
        remoteKernelFinder = mock<IRemoteKernelFinder>();
        pathUtils = mock(PathUtils);
        when(pathUtils.getDisplayName(anything())).thenReturn('<user friendly path>');
        when(pathUtils.getDisplayName(anything(), anything())).thenReturn('<user friendly path>');
        when(kernelService.findMatchingInterpreter(anything(), anything())).thenResolve(undefined);
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        const interpreterService = mock<IInterpreterService>();
        when(interpreterService.getActiveInterpreter(anything())).thenResolve();
        const rawSupportedService = mock<IRawNotebookSupportedService>();
        when(rawSupportedService.supported()).thenResolve(true);
        kernelSelectionProvider = new KernelSelectionProvider(instance(kernelFinder), instance(remoteKernelFinder));
    });
    teardown(() => disposeAllDisposables(disposableRegistry));

    test('Should return a list with the proper details in the quick pick for remote connections', async () => {
        const activeKernels: IJupyterKernel[] = [activePython1KernelModel, activeJuliaKernelModel];
        const sessions = activeKernels.map((item, index) => {
            return {
                id: `sessionId${index}`,
                name: 'someSession',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                kernel: { id: `sessionId${index}`, ...(item as any) },
                type: '',
                path: ''
            };
        });
        when(kernelService.getKernelSpecs(instance(sessionManager), anything())).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenResolve(activeKernels);
        when(sessionManager.getRunningSessions()).thenResolve(sessions);
        when(sessionManager.getKernelSpecs()).thenResolve(allSpecs);

        // Quick pick must contain
        // - kernel spec display name
        // - selection = kernel model + kernel spec
        // - description = last activity and # of connections.
        const expectedItems: IKernelSpecQuickPickItem[] = [
            {
                label: python1KernelSpecModel.display_name,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                selection: {
                    interpreter: undefined,
                    kernelModel: {
                        ...activePython1KernelModel,
                        ...python1KernelSpecModel,
                        id: 'sessionId0',
                        session: {
                            id: 'sessionId0',
                            name: 'someSession',
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            kernel: { id: 'sessionId0', ...(activeKernels[0] as any) },
                            type: '',
                            path: ''
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } as any
                    },
                    kind: 'connectToLiveKernel'
                },
                detail: '<user friendly path>',
                description: localize.DataScience.jupyterSelectURIRunningDetailFormat().format(
                    activePython1KernelModel.lastActivityTime.toLocaleString(),
                    activePython1KernelModel.numberOfConnections.toString()
                )
            },
            {
                label: juliaKernelSpecModel.display_name,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                selection: {
                    interpreter: undefined,
                    kernelModel: {
                        ...activeJuliaKernelModel,
                        ...juliaKernelSpecModel,
                        id: 'sessionId1',
                        session: {
                            id: 'sessionId1',
                            name: 'someSession',
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            kernel: { id: 'sessionId1', ...(activeKernels[1] as any) },
                            type: '',
                            path: ''
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } as any
                    },
                    kind: 'connectToLiveKernel'
                },
                detail: '<user friendly path>',
                description: localize.DataScience.jupyterSelectURIRunningDetailFormat().format(
                    activeJuliaKernelModel.lastActivityTime.toLocaleString(),
                    activeJuliaKernelModel.numberOfConnections.toString()
                )
            }
        ];
        expectedItems.sort((a, b) => (a.label === b.label ? 0 : a.label > b.label ? 1 : -1));

        const items = await kernelSelectionProvider.getKernelSelections(undefined, undefined, undefined);
        assert.deepEqual(items, expectedItems);
    });
    test('Should return a list of Local Kernels + Interpreters for local raw connection', async () => {
        when(kernelFinder.listKernels(anything())).thenResolve(allMetadata);
        when(interpreterSelector.getSuggestions(undefined)).thenResolve(allInterpreters);

        // Quick pick must contain
        // - kernel spec display name
        // - selection = kernel model + kernel spec
        // - description = last activity and # of connections.
        const expectedKernelItems: IKernelSpecQuickPickItem[] = allSpecs.map((item) => {
            return {
                label: item.display_name,
                detail: '<user friendly path>',
                selection: {
                    interpreter: undefined,
                    kernelModel: undefined,
                    kernelSpec: item,
                    kind: 'startUsingKernelSpec'
                }
            };
        });
        const expectedInterpreterItems: IKernelSpecQuickPickItem[] = allInterpreters.map((item) => {
            return {
                ...item,
                label: item.label,
                detail: '<user friendly path>',
                description: '',
                selection: {
                    kernelModel: undefined,
                    interpreter: item.interpreter,
                    kernelSpec: undefined,
                    kind: 'startUsingPythonInterpreter'
                }
            };
        });
        const expectedList = [...expectedKernelItems, ...expectedInterpreterItems];
        expectedList.sort((a, b) => (a.label === b.label ? 0 : a.label > b.label ? 1 : -1));

        const items = await kernelSelectionProvider.getKernelSelections(undefined, undefined);

        // Ensure interpreter property is set when comparing.
        items.map((item) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((item.selection as unknown) as any).interpreter = item.selection.interpreter || undefined;
        });
        assert.deepEqual(items, expectedList);
    });
    test('Should return a list of Local Kernels + Interpreters for local jupyter connection', async () => {
        when(sessionManager.getKernelSpecs()).thenResolve(allSpecs);
        when(kernelService.getKernelSpecs(anything(), anything())).thenResolve(allSpecs);
        when(kernelFinder.listKernels(anything())).thenResolve(allMetadata);
        when(interpreterSelector.getSuggestions(undefined)).thenResolve(allInterpreters);

        // Quick pick must contain
        // - kernel spec display name
        // - selection = kernel model + kernel spec
        // - description = last activity and # of connections.
        const expectedKernelItems: IKernelSpecQuickPickItem[] = allSpecs.map((item) => {
            return {
                label: item.display_name,
                detail: '<user friendly path>',
                selection: {
                    interpreter: undefined,
                    kernelModel: undefined,
                    kernelSpec: item,
                    kind: 'startUsingKernelSpec'
                }
            };
        });
        const expectedInterpreterItems: IKernelSpecQuickPickItem[] = allInterpreters.map((item) => {
            return {
                ...item,
                label: item.label,
                detail: '<user friendly path>',
                description: '',
                selection: {
                    kernelModel: undefined,
                    interpreter: item.interpreter,
                    kernelSpec: undefined,
                    kind: 'startUsingPythonInterpreter'
                }
            };
        });
        const expectedList = [...expectedKernelItems, ...expectedInterpreterItems];
        expectedList.sort((a, b) => (a.label === b.label ? 0 : a.label > b.label ? 1 : -1));

        const items = await kernelSelectionProvider.getKernelSelections(undefined, undefined);

        assert.deepEqual(items, expectedList);
    });
});
