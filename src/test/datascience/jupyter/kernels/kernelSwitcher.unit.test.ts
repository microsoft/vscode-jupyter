// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter } from 'vscode';
import { ApplicationShell } from '../../../../client/common/application/applicationShell';
import { IApplicationShell } from '../../../../client/common/application/types';
import { JupyterSettings } from '../../../../client/common/configSettings';
import { ConfigurationService } from '../../../../client/common/configuration/service';
import { IConfigurationService, IWatchableJupyterSettings } from '../../../../client/common/types';
import { Common } from '../../../../client/common/utils/localize';
import { EXTENSION_ROOT_DIR } from '../../../../client/constants';
import { JupyterSessionStartError } from '../../../../client/datascience/baseJupyterSession';
import { NotebookProvider } from '../../../../client/datascience/interactive-common/notebookProvider';
import { JupyterNotebookBase } from '../../../../client/datascience/jupyter/jupyterNotebook';
import { KernelSelector } from '../../../../client/datascience/jupyter/kernels/kernelSelector';
import { KernelSwitcher } from '../../../../client/datascience/jupyter/kernels/kernelSwitcher';
import { KernelConnectionMetadata, LiveKernelModel } from '../../../../client/datascience/jupyter/kernels/types';
import { IJupyterConnection, IJupyterKernelSpec, INotebook } from '../../../../client/datascience/types';
import { PythonEnvironment } from '../../../../client/pythonEnvironments/info';
import { noop } from '../../../core';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('DataScience - Kernel Switcher', () => {
    let kernelSwitcher: KernelSwitcher;
    let configService: IConfigurationService;
    let kernelSelector: KernelSelector;
    let appShell: IApplicationShell;
    let notebook: INotebook;
    let connection: IJupyterConnection;
    let currentKernel: IJupyterKernelSpec | LiveKernelModel;
    let selectedInterpreter: PythonEnvironment;
    let settings: IWatchableJupyterSettings;
    let newKernelConnection: KernelConnectionMetadata;
    setup(() => {
        connection = mock<IJupyterConnection>();
        settings = mock(JupyterSettings);
        currentKernel = {
            lastActivityTime: new Date(),
            name: 'CurrentKernel',
            numberOfConnections: 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            session: {} as any
        };
        selectedInterpreter = {
            path: '',
            sysPrefix: '',
            sysVersion: ''
        };
        newKernelConnection = {
            kernelModel: currentKernel,
            interpreter: selectedInterpreter,
            kind: 'connectToLiveKernel'
        };
        notebook = mock(JupyterNotebookBase);
        configService = mock(ConfigurationService);
        kernelSelector = mock(KernelSelector);
        appShell = mock(ApplicationShell);
        const notebookProvider = mock(NotebookProvider);
        when(notebookProvider.type).thenReturn('jupyter');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(notebook.connection).thenReturn(instance(connection));
        when(configService.getSettings(anything())).thenReturn(instance(settings));
        kernelSwitcher = new KernelSwitcher(instance(configService), instance(appShell), instance(kernelSelector));
        when(appShell.withProgress(anything(), anything())).thenCall(async (_, cb: () => Promise<void>) => {
            await cb();
        });
    });

    [true, false].forEach((isLocalConnection) => {
        // eslint-disable-next-line
        suite(isLocalConnection ? 'Local Connection' : 'Remote Connection', () => {
            setup(() => {
                const jupyterConnection: IJupyterConnection = {
                    type: 'jupyter',
                    localLaunch: isLocalConnection,
                    baseUrl: '',
                    disconnected: new EventEmitter<number>().event,
                    hostName: '',
                    token: '',
                    localProcExitCode: 0,
                    valid: true,
                    displayName: '',
                    dispose: noop,
                    rootDirectory: EXTENSION_ROOT_DIR
                };
                when(notebook.connection).thenReturn(jupyterConnection);
            });
            teardown(function () {
                // eslint-disable-next-line no-invalid-this
                if (this.runnable().state) {
                    // We should have checked if it was a local connection.
                    verify(notebook.connection).atLeast(1);
                }
            });

            [
                { title: 'Without an existing kernel', currentKernel: undefined },
                { title: 'With an existing kernel', currentKernel }
            ].forEach((currentKernelInfo) => {
                suite(currentKernelInfo.title, () => {
                    setup(() => {
                        when(notebook.getKernelConnection()).thenReturn({
                            kernelSpec: currentKernelInfo.currentKernel as any,
                            kind: 'startUsingKernelSpec'
                        });
                    });

                    test('Switch to new kernel', async () => {
                        await kernelSwitcher.switchKernelWithRetry(instance(notebook), newKernelConnection);
                        verify(notebook.setKernelConnection(anything(), anything())).once();
                    });
                    test('Switch to new kernel with error', async () => {
                        const ex = new JupyterSessionStartError(new Error('Kaboom'));
                        when(notebook.setKernelConnection(anything(), anything())).thenReject(ex);
                        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve(
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            Common.cancel() as any
                        );

                        // This wouldn't normally fail for remote because sessions should always start if
                        // the remote server is up but both should throw
                        try {
                            await kernelSwitcher.switchKernelWithRetry(instance(notebook), newKernelConnection);
                            assert.fail('Should throw exception');
                        } catch {
                            // This is expected
                        }
                        if (isLocalConnection) {
                            verify(kernelSelector.askForLocalKernel(anything(), anything(), anything())).once();
                        }
                    });
                });
            });
        });
    });
});
