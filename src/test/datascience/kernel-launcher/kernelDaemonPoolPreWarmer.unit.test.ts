// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { PythonExtensionChecker } from '../../../client/api/pythonApi';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { JupyterSettings } from '../../../client/common/configSettings';
import { IConfigurationService, IExperimentService, IWatchableJupyterSettings } from '../../../client/common/types';
import { KernelDaemonPool } from '../../../client/datascience/kernel-launcher/kernelDaemonPool';
import { KernelDaemonPreWarmer } from '../../../client/datascience/kernel-launcher/kernelDaemonPreWarmer';
import {
    IInteractiveWindowProvider,
    INotebookCreationTracker,
    INotebookEditorProvider,
    IRawNotebookSupportedService
} from '../../../client/datascience/types';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('DataScience - Kernel Daemon Pool PreWarmer', () => {
    let prewarmer: KernelDaemonPreWarmer;
    let notebookEditorProvider: INotebookEditorProvider;
    let interactiveProvider: IInteractiveWindowProvider;
    let usageTracker: INotebookCreationTracker;
    let rawNotebookSupported: IRawNotebookSupportedService;
    let configService: IConfigurationService;
    let daemonPool: KernelDaemonPool;
    let settings: IWatchableJupyterSettings;
    let vscodeNotebook: IVSCodeNotebook;
    let extensionChecker: PythonExtensionChecker;
    setup(() => {
        notebookEditorProvider = mock<INotebookEditorProvider>();
        interactiveProvider = mock<IInteractiveWindowProvider>();
        usageTracker = mock<INotebookCreationTracker>();
        daemonPool = mock<KernelDaemonPool>();
        rawNotebookSupported = mock<IRawNotebookSupportedService>();
        configService = mock<IConfigurationService>();
        vscodeNotebook = mock<IVSCodeNotebook>();
        const experimentService = mock<IExperimentService>();
        when(experimentService.inExperiment(anything())).thenResolve(true);
        extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

        // Set up our config settings
        settings = mock(JupyterSettings);
        when(configService.getSettings()).thenReturn(instance(settings));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any

        prewarmer = new KernelDaemonPreWarmer(
            instance(notebookEditorProvider),
            instance(interactiveProvider),
            [],
            instance(usageTracker),
            instance(daemonPool),
            instance(rawNotebookSupported),
            instance(configService),
            instance(vscodeNotebook),
            instance(extensionChecker)
        );
    });
    test('Should not pre-warm daemon pool if ds was never used', async () => {
        when(rawNotebookSupported.supported()).thenResolve(true);
        when(usageTracker.lastPythonNotebookCreated).thenReturn(undefined);

        await prewarmer.activate(undefined);

        verify(daemonPool.preWarmKernelDaemons()).never();
    });
    test('Should not pre-warm daemon pool if python is not installed', async () => {
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(false);

        await prewarmer.activate(undefined);

        verify(daemonPool.preWarmKernelDaemons()).never();
    });

    test('Should not pre-warm daemon pool raw kernel is not supported', async () => {
        when(rawNotebookSupported.supported()).thenResolve(false);

        await prewarmer.activate(undefined);

        verify(daemonPool.preWarmKernelDaemons()).never();
    });

    test('Prewarm if supported and the date works', async () => {
        when(rawNotebookSupported.supported()).thenResolve(true);
        when(usageTracker.lastPythonNotebookCreated).thenReturn(new Date());

        await prewarmer.activate(undefined);

        verify(daemonPool.preWarmKernelDaemons()).once();
    });
});
