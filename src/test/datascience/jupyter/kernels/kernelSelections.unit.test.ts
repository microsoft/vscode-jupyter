// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { PythonExtensionChecker } from '../../../../client/api/pythonApi';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { FileSystem } from '../../../../client/common/platform/fileSystem';
import { PathUtils } from '../../../../client/common/platform/pathUtils';
import { IFileSystem } from '../../../../client/common/platform/types';
import { IPathUtils } from '../../../../client/common/types';
import * as localize from '../../../../client/common/utils/localize';
import { JupyterSessionManager } from '../../../../client/datascience/jupyter/jupyterSessionManager';
import { KernelSelectionProvider } from '../../../../client/datascience/jupyter/kernels/kernelSelections';
import { KernelService } from '../../../../client/datascience/jupyter/kernels/kernelService';
import { IKernelSpecQuickPickItem } from '../../../../client/datascience/jupyter/kernels/types';
import { IKernelFinder } from '../../../../client/datascience/kernel-launcher/types';
import { IJupyterKernel, IJupyterKernelSpec, IJupyterSessionManager } from '../../../../client/datascience/types';
import { IInterpreterQuickPickItem, IInterpreterSelector } from '../../../../client/interpreter/configuration/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';

// eslint-disable-next-line
suite('DataScience - KernelSelections', () => {
    let kernelSelectionProvider: KernelSelectionProvider;
    let kernelService: KernelService;
    let kernelFinder: IKernelFinder;
    let interpreterSelector: IInterpreterSelector;
    let pathUtils: IPathUtils;
    let fs: IFileSystem;
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

    setup(() => {
        interpreterSelector = mock<IInterpreterSelector>();
        sessionManager = mock(JupyterSessionManager);
        kernelService = mock(KernelService);
        kernelFinder = mock<IKernelFinder>();
        fs = mock(FileSystem);
        pathUtils = mock(PathUtils);
        when(pathUtils.getDisplayName(anything())).thenReturn('<user friendly path>');
        when(pathUtils.getDisplayName(anything(), anything())).thenReturn('<user friendly path>');
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        const interpreterService = mock<IInterpreterService>();
        when(interpreterService.getActiveInterpreter(anything())).thenResolve();
        kernelSelectionProvider = new KernelSelectionProvider(
            instance(kernelService),
            instance(interpreterSelector),
            instance(interpreterService),
            instance(fs),
            instance(pathUtils),
            instance(kernelFinder),
            instance(extensionChecker)
        );
    });

    test('Should return an empty list for remote kernels if there are none', async () => {
        when(kernelService.getKernelSpecs(instance(sessionManager), anything())).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenResolve([]);
        when(sessionManager.getRunningSessions()).thenResolve([]);

        const items = await kernelSelectionProvider.getKernelSelectionsForRemoteSession(
            undefined,
            instance(sessionManager)
        );

        assert.equal(items.length, 0);
    });
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

        const items = await kernelSelectionProvider.getKernelSelectionsForRemoteSession(
            undefined,
            instance(sessionManager)
        );

        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.getKernelSpecs()).once();
        assert.deepEqual(items, expectedItems);
    });
    test('Should return a list of Local Kernels + Interpreters for local raw connection', async () => {
        when(kernelFinder.listKernelSpecs(anything())).thenResolve(allSpecs);
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

        const items = await kernelSelectionProvider.getKernelSelectionsForLocalSession(
            undefined,
            'raw',
            instance(sessionManager)
        );

        // Ensure interpreter property is set when comparing.
        items.map((item) => {
            (item.selection as any).interpreter = item.selection.interpreter || undefined;
        });
        assert.deepEqual(items, expectedList);
    });
    test('Should return a list of Local Kernels + Interpreters for local jupyter connection', async () => {
        when(sessionManager.getKernelSpecs()).thenResolve(allSpecs);
        when(kernelService.getKernelSpecs(anything(), anything())).thenResolve(allSpecs);
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

        const items = await kernelSelectionProvider.getKernelSelectionsForLocalSession(
            undefined,
            'jupyter',
            instance(sessionManager)
        );

        verify(kernelService.getKernelSpecs(anything(), anything())).once();
        assert.deepEqual(items, expectedList);
    });
});
