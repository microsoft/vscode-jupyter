/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as dedent from 'dedent';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Uri, WorkspaceFolder } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { Common, DataScience } from '../../platform/common/utils/localize';
import { IBrowserService, IConfigurationService } from '../../platform/common/types';
import {
    IKernelDependencyService,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse
} from '../../platform/../kernels/types';
import { getOSType, OSType } from '../common';
import { PythonEnvironment, EnvironmentType } from '../../platform/pythonEnvironments/info';
import { JupyterInterpreterService } from '../../kernels/jupyter/interpreter/jupyterInterpreterService.node';
import { DataScienceErrorHandler } from '../../platform/errors/errorHandler.node';
import { JupyterConnectError } from '../../platform/errors/jupyterConnectError';
import { JupyterInstallError } from '../../platform/errors/jupyterInstallError';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError.node';
import { KernelDiedError } from '../../platform/errors/kernelDiedError.node';
import {
    IJupyterInterpreterDependencyManager,
    JupyterInterpreterDependencyResponse
} from '../../kernels/jupyter/types';

suite('DataScience Error Handler Unit Tests', () => {
    let applicationShell: IApplicationShell;
    let dataScienceErrorHandler: DataScienceErrorHandler;
    let dependencyManager: IJupyterInterpreterDependencyManager;
    let workspaceService: IWorkspaceService;
    let browser: IBrowserService;
    let configuration: IConfigurationService;
    let jupyterInterpreterService: JupyterInterpreterService;
    let kernelDependencyInstaller: IKernelDependencyService;
    const jupyterInterpreter: PythonEnvironment = {
        displayName: 'Hello',
        path: 'Some Path',
        sysPrefix: ''
    };

    setup(() => {
        applicationShell = mock<IApplicationShell>();
        workspaceService = mock<IWorkspaceService>();
        dependencyManager = mock<IJupyterInterpreterDependencyManager>();
        configuration = mock<IConfigurationService>();
        browser = mock<IBrowserService>();
        jupyterInterpreterService = mock<JupyterInterpreterService>();
        when(dependencyManager.installMissingDependencies(anything())).thenResolve();
        when(workspaceService.workspaceFolders).thenReturn([]);
        kernelDependencyInstaller = mock<IKernelDependencyService>();
        when(kernelDependencyInstaller.areDependenciesInstalled(anything(), anything(), anything())).thenResolve(true);
        dataScienceErrorHandler = new DataScienceErrorHandler(
            instance(applicationShell),
            instance(dependencyManager),
            instance(browser),
            instance(configuration),
            instance(kernelDependencyInstaller),
            instance(workspaceService)
        );
        when(applicationShell.showErrorMessage(anything())).thenResolve();
        when(applicationShell.showErrorMessage(anything(), anything())).thenResolve();
        when(applicationShell.showErrorMessage(anything(), anything(), anything())).thenResolve();
    });
    const message = 'Test error message.';

    test('Default error', async () => {
        when(applicationShell.showErrorMessage(anything())).thenResolve();

        const err = new Error(message);
        await dataScienceErrorHandler.handleError(err);

        verify(applicationShell.showErrorMessage(anything())).once();
    });

    test('Jupyter Self Certificates Error', async () => {
        when(applicationShell.showErrorMessage(anything(), anything(), anything())).thenResolve(message as any);

        const err = new JupyterSelfCertsError(message);
        await dataScienceErrorHandler.handleError(err);

        verify(applicationShell.showErrorMessage(anything())).never();
        verify(
            applicationShell.showErrorMessage(
                err.message,
                DataScience.jupyterSelfCertEnable(),
                DataScience.jupyterSelfCertClose()
            )
        ).never();
    });

    test('Jupyter Install Error', async () => {
        when(
            applicationShell.showInformationMessage(
                anything(),
                DataScience.jupyterInstall(),
                DataScience.notebookCheckForImportNo(),
                anything()
            )
        ).thenResolve(DataScience.jupyterInstall() as any);

        const err = new JupyterInstallError(message);
        await dataScienceErrorHandler.handleError(err);

        verify(dependencyManager.installMissingDependencies(err)).once();
    });

    suite('Kernel startup errors', () => {
        let kernelConnection: KernelConnectionMetadata;
        setup(() => {
            when(applicationShell.showErrorMessage(anything(), Common.learnMore())).thenResolve(
                Common.learnMore() as any
            );
            kernelConnection = {
                id: '',
                kind: 'startUsingPythonInterpreter',
                interpreter: {
                    path: 'Hello There',
                    sysPrefix: 'Something else',
                    displayName: 'Hello (Some Path)'
                },
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    path: ''
                }
            };
        });
        const stdErrorMessages = {
            userOrverridingRandomPyFile_Unix: dedent`
                Info 14:45:47: KernelProcess Exit Exit - 1 Traceback (most recent call last):
                File "/home/xyz/.pyenv/versions/3.8.12/lib/python3.8/runpy.py", line 194, in _run_module_as_main
                    return _run_code(code, main_globals, None,
                File "/home/xyz/.pyenv/versions/3.8.12/lib/python3.8/runpy.py", line 87, in _run_code
                    exec(code, run_globals)
                File "/home/xyz/samples/pySamples/crap/.venvNoIPythonGenUtils/lib/python3.8/site-packages/ipykernel_launcher.py", line 15, in <module>
                    from ipykernel import kernelapp as app
                File "/home/xyz/samples/pySamples/crap/.venvNoIPythonGenUtils/lib/python3.8/site-packages/ipykernel/__init__.py", line 2, in <module>
                    from .connect import *
                File "/home/xyz/samples/pySamples/crap/.venvNoIPythonGenUtils/lib/python3.8/site-packages/ipykernel/connect.py", line 10, in <module>
                    import jupyter_client
                File "/home/xyz/samples/pySamples/crap/.venvNoIPythonGenUtils/lib/python3.8/site-packages/jupyter_client/__init__.py", line 6, in <module>
                    from .asynchronous import AsyncKernelClient  # noqa
                File "/home/xyz/samples/pySamples/crap/.venvNoIPythonGenUtils/lib/python3.8/site-packages/jupyter_client/asynchronous/__init__.py", line 1, in <module>
                    from .client import AsyncKernelClient  # noqa
                File "/home/xyz/samples/pySamples/crap/.venvNoIPythonGenUtils/lib/python3.8/site-packages/jupyter_client/asynchronous/client.py", line 6, in <module>
                    from jupyter_client.channels import HBChannel
                File "/home/xyz/samples/pySamples/crap/.venvNoIPythonGenUtils/lib/python3.8/site-packages/jupyter_client/channels.py", line 4, in <module>
                    import asyncio
                File "/home/xyz/.pyenv/versions/3.8.12/lib/python3.8/asyncio/__init__.py", line 8, in <module>
                    from .base_events import *
                File "/home/xyz/.pyenv/versions/3.8.12/lib/python3.8/asyncio/base_events.py", line 18, in <module>
                    import concurrent.futures
                File "/home/xyz/.pyenv/versions/3.8.12/lib/python3.8/concurrent/futures/__init__.py", line 8, in <module>
                    from concurrent.futures._base import (FIRST_COMPLETED,
                File "/home/xyz/.pyenv/versions/3.8.12/lib/python3.8/concurrent/futures/_base.py", line 7, in <module>
                    import logging
                File "/home/xyz/.pyenv/versions/3.8.12/lib/python3.8/logging/__init__.py", line 28, in <module>
                    from string import Template
                ImportError: cannot import name 'Template' from 'string' (/home/xyz/samples/pySamples/crap/kernel_crash/no_start/string.py)
                `,
            userOrverridingRandomPyFile_Windows: `
                Info 14:16:26: Cancel pending cells
                Info 14:16:26: KernelProcess Exit Exit - 1 Traceback (most recent call last):
                    File "C:\\Python39\\lib\\runpy.py", line 197, in _run_module_as_main
                    return _run_code(code, main_globals, None,
                    File "C:\\Python39\\lib\\runpy.py", line 87, in _run_code
                    exec(code, run_globals)
                    File "c:\\Development\\samples\\pySamples\\sample1\\.venvKernel\\lib\\site-packages\\ipykernel_launcher.py", line 15, in <module>
                    from ipykernel import kernelapp as app
                    File "c:\\Development\\samples\\pySamples\\sample1\\.venvKernel\\lib\\site-packages\\ipykernel\\__init__.py", line 2, in <module>
                    from .connect import *
                    File "c:\\Development\\samples\\pySamples\\sample1\\.venvKernel\\lib\\site-packages\\ipykernel\\connect.py", line 11, in <module>
                    import jupyter_client
                    File "c:\\Development\\samples\\pySamples\\sample1\\.venvKernel\\lib\\site-packages\\jupyter_client\\__init__.py", line 6, in <module>
                    from .asynchronous import AsyncKernelClient  # noqa
                    File "c:\\Development\\samples\\pySamples\\sample1\\.venvKernel\\lib\\site-packages\\jupyter_client\\asynchronous\\__init__.py", line 1, in <module>
                    from .client import AsyncKernelClient  # noqa
                    File "c:\\Development\\samples\\pySamples\\sample1\\.venvKernel\\lib\\site-packages\\jupyter_client\\asynchronous\\client.py", line 6, in <module>
                    from jupyter_client.channels import HBChannel
                    File "c:\\Development\\samples\\pySamples\\sample1\\.venvKernel\\lib\\site-packages\\jupyter_client\\channels.py", line 4, in <module>
                    import asyncio
                    File "C:\\Python39\\lib\\asyncio\\__init__.py", line 43, in <module>
                    from .windows_events import *
                    File "C:\\Python39\\lib\\asyncio\\windows_events.py", line 20, in <module>
                    from . import windows_utils
                    File "C:\\Python39\\lib\\asyncio\\windows_utils.py", line 13, in <module>
                    import tempfile
                    File "C:\\Python39\\lib\\tempfile.py", line 45, in <module>
                    from random import Random as _Random
                ImportError: cannot import name 'Random' from 'random' (c:\\Development\\samples\\pySamples\\sample1\\kernel_issues\\start\\random.py)
                `,
            failureToStartJupyter: `namespace, args = self._parse_known_args(args, namespace)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 2062, in _parse_known_args
                    start_index = consume_optional(start_index)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 2002, in consume_optional
                    take_action(action, args, option_string)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 1930, in take_action
                    action(self, namespace, argument_values, option_string)
                File "/home/don/samples/pySamples/crap/.venvJupyter/lib/python3.9/site-packages/traitlets/config/loader.py", line 913, in __call__
                    raise NotImplementedError("subclasses must implement __call__")
                NotImplementedError: subclasses must implement __call__`,
            failureToStartJupyterDueToOutdatedTraitlets: `namespace, args = self._parse_known_args(args, namespace)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 2062, in _parse_known_args
                    start_index = consume_optional(start_index)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 2002, in consume_optional
                    take_action(action, args, option_string)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 1930, in take_action
                    action(self, namespace, argument_values, option_string)
                File "/home/don/samples/pySamples/crap/.venvJupyter/lib/python3.9/site-packages/traitlets/config/loader.py", line 913, in __call__
                    raise NotImplementedError("subclasses must implement __call__")
                AttributeError: 'Namespace' object has no attribute '_flags'`
        };
        test('Unable to import <name> from user overriding module (windows)', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOrverridingRandomPyFile_Windows,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined
            );

            const expectedMessage = DataScience.failedToStartKernelDueToImportFailureFromFile().format(
                'Random',
                getDisplayPath('c:\\Development\\samples\\pySamples\\sample1\\kernel_issues\\start\\random.py', [])
            );

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresModuleImportErrFromFile');
        });
        test('Unable to import <name> from user overriding module in workspace folder (windows)', async () => {
            const workspaceFolders: WorkspaceFolder[] = [
                {
                    index: 0,
                    name: '',
                    uri: Uri.file('c:\\Development\\samples\\pySamples\\sample1\\kernel_issues')
                }
            ];
            when(workspaceService.workspaceFolders).thenReturn(workspaceFolders);
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOrverridingRandomPyFile_Windows,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined
            );

            const expectedMessage = DataScience.fileSeemsToBeInterferingWithKernelStartup().format(
                getDisplayPath(
                    'c:\\Development\\samples\\pySamples\\sample1\\kernel_issues\\start\\random.py',
                    workspaceFolders
                )
            );

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresOverridingBuiltInModules');
        });
        test('Unable to import <name> from user overriding module (linux)', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOrverridingRandomPyFile_Unix,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined
            );

            const expectedMessage = DataScience.failedToStartKernelDueToImportFailureFromFile().format(
                'Template',
                getDisplayPath('/home/xyz/samples/pySamples/crap/kernel_crash/no_start/string.py', [])
            );

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresModuleImportErrFromFile');
        });
        test('Unable to import <name> from user overriding module in workspace folder (unix)', async function () {
            if (getOSType() == OSType.Windows) {
                // Patsh get converted to `\` when using `Uri.file` as values for Workspace folder.
                return this.skip();
            }
            const workspaceFolders: WorkspaceFolder[] = [
                {
                    index: 0,
                    name: '',
                    uri: Uri.file('/home/xyz/samples/pySamples/crap/')
                }
            ];
            when(workspaceService.workspaceFolders).thenReturn(workspaceFolders);
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOrverridingRandomPyFile_Unix,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined
            );

            const expectedMessage = DataScience.fileSeemsToBeInterferingWithKernelStartup().format(
                getDisplayPath('/home/xyz/samples/pySamples/crap/kernel_crash/no_start/string.py', workspaceFolders)
            );

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresOverridingBuiltInModules');
        });
        test('Win32api Errors', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    `
import win32api
ImportError: No module named 'win32api'
`,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined
            );

            const expectedMessage = DataScience.failedToStartKernelDueToWin32APIFailure();

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresWin32Api');
        });

        test('Unable to import xyz', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    `
import xyz
ImportError: No module named 'xyz'
`,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined
            );

            const expectedMessage = DataScience.failedToStartKernelDueToImportFailure().format('xyz');

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresModuleImportErr');
        });
        test('pyzmq errors', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    `ImportError: cannot import name 'constants' from partially initialized module 'zmq.backend.cython' (most likely due to a circular import) (C:\\Users\\<user>\\AppData\\Roaming\\Python\\Python38\\site-packages\\zmq\\backend\\cython\\__init__.py)`,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined
            );

            const expectedMessage = DataScience.failedToStartKernelDueToPyZmqFailure();

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresPyzmq');
        });
        test('Unknown Dll load failure', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError('Hello', `ImportError: DLL load failed`, undefined, kernelConnection),
                'start',
                kernelConnection,
                undefined
            );

            const expectedMessage = DataScience.failedToStartKernelDueToUnknowDllLoadFailure();

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresDllLoad');
        });
        test('Dll load failure', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError('Hello', `import XYZ\nImportError: DLL load failed`, undefined, kernelConnection),
                'start',
                kernelConnection,
                undefined
            );

            const expectedMessage = DataScience.failedToStartKernelDueToDllLoadFailure().format('XYZ');

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresDllLoad');
        });

        async function verifyJupyterErrors(stdError: string, expectedMessage: string, expectedLink?: string) {
            when(jupyterInterpreterService.getSelectedInterpreter()).thenResolve(jupyterInterpreter);
            when(jupyterInterpreterService.getSelectedInterpreter(anything())).thenResolve(jupyterInterpreter);
            await dataScienceErrorHandler.handleKernelError(
                new JupyterConnectError(stdError, `xyz`),
                'start',
                kernelConnection,
                undefined
            );

            verifyErrorMessage(expectedMessage, expectedLink);
        }
        test('Failure to start Jupyter Server (unable to extract python error message)', async () => {
            const envDisplayName = `${jupyterInterpreter.displayName} (${jupyterInterpreter.path})`;
            const expectedMessage = DataScience.failedToStartJupyter().format(envDisplayName);
            await verifyJupyterErrors('Kaboom', expectedMessage);
        });
        test('Failure to start Jupyter Server (unable to extract python error message), (without failure about jupyter error, without daemon)', async () => {
            const envDisplayName = `${jupyterInterpreter.displayName} (${jupyterInterpreter.path})`;
            const expectedMessage = DataScience.failedToStartJupyter().format(envDisplayName);
            await verifyJupyterErrors('kaboom', expectedMessage);
        });
        test('Failure to start Jupyter Server', async () => {
            const stdError = `${stdErrorMessages.failureToStartJupyter}

Failed to run jupyter as observable with args notebook --no-browser --notebook-dir="/home/don/samples/pySamples/crap" --config=/tmp/40aa74ae-d668-4225-8201-4570c9a0ac4a/jupyter_notebook_config.py --NotebookApp.iopub_data_rate_limit=10000000000.0`;
            const envDisplayName = `${jupyterInterpreter.displayName} (${jupyterInterpreter.path})`;
            const pythonError = 'NotImplementedError: subclasses must implement __call__';
            const expectedMessage = DataScience.failedToStartJupyterWithErrorInfo().format(envDisplayName, pythonError);
            await verifyJupyterErrors(stdError, expectedMessage);
        });
        test('Failure to start Jupyter Server (without failure about jupyter error, without daemon)', async () => {
            const stdError = stdErrorMessages.failureToStartJupyter;
            const envDisplayName = `${jupyterInterpreter.displayName} (${jupyterInterpreter.path})`;
            const pythonError = 'NotImplementedError: subclasses must implement __call__';
            const expectedMessage = DataScience.failedToStartJupyterWithErrorInfo().format(envDisplayName, pythonError);
            await verifyJupyterErrors(stdError, expectedMessage);
        });
        test('Failure to start Jupyter Server due to outdated traitlets', async () => {
            const stdError = `${stdErrorMessages.failureToStartJupyterDueToOutdatedTraitlets}

Failed to run jupyter as observable with args notebook --no-browser --notebook-dir="/home/don/samples/pySamples/crap" --config=/tmp/40aa74ae-d668-4225-8201-4570c9a0ac4a/jupyter_notebook_config.py --NotebookApp.iopub_data_rate_limit=10000000000.0`;
            const envDisplayName = `${jupyterInterpreter.displayName} (${jupyterInterpreter.path})`;
            const pythonError = "AttributeError: 'Namespace' object has no attribute '_flags'";
            const expectedMessage = DataScience.failedToStartJupyterDueToOutdatedTraitlets().format(
                envDisplayName,
                pythonError
            );

            await verifyJupyterErrors(
                stdError,
                expectedMessage,
                'https://aka.ms/kernelFailuresJupyterTrailtletsOutdated'
            );
        });
        test('Failure to start Jupyter Server due to outdated traitlets (without failure about jupyter error, without daemon)', async () => {
            const stdError = stdErrorMessages.failureToStartJupyterDueToOutdatedTraitlets;
            const envDisplayName = `${jupyterInterpreter.displayName} (${jupyterInterpreter.path})`;
            const pythonError = "AttributeError: 'Namespace' object has no attribute '_flags'";
            const expectedMessage = DataScience.failedToStartJupyterDueToOutdatedTraitlets().format(
                envDisplayName,
                pythonError
            );
            await verifyJupyterErrors(
                stdError,
                expectedMessage,
                'https://aka.ms/kernelFailuresJupyterTrailtletsOutdated'
            );
        });
        test('Check Jupyter dependencies when JupyterInstall error is thrown', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new JupyterInstallError('foo'),
                'start',
                kernelConnection,
                undefined
            );
            verify(dependencyManager.installMissingDependencies(anything())).once();
        });
        test('When JupyterInstall error is thrown and Jupyter dependencies are installed, then return ok', async () => {
            when(dependencyManager.installMissingDependencies(anything())).thenResolve(
                JupyterInterpreterDependencyResponse.ok
            );
            const result = await dataScienceErrorHandler.handleKernelError(
                new JupyterInstallError('foo'),
                'start',
                kernelConnection,
                undefined
            );
            verify(dependencyManager.installMissingDependencies(anything())).once();
            assert.strictEqual(result, KernelInterpreterDependencyResponse.ok);
        });
        test('When JupyterInstall error is thrown and Jupyter dependencies are not installed, then return cancel', async () => {
            when(dependencyManager.installMissingDependencies(anything())).thenResolve(
                JupyterInterpreterDependencyResponse.cancel
            );
            const result = await dataScienceErrorHandler.handleKernelError(
                new JupyterInstallError('foo'),
                'start',
                kernelConnection,
                undefined
            );
            verify(dependencyManager.installMissingDependencies(anything())).once();
            assert.strictEqual(result, KernelInterpreterDependencyResponse.cancel);
        });
        test('Verify error message for conda install of ipykernel', async () => {
            when(kernelDependencyInstaller.areDependenciesInstalled(anything(), anything(), anything())).thenResolve(
                false
            );
            when(dependencyManager.installMissingDependencies(anything())).thenResolve(
                JupyterInterpreterDependencyResponse.cancel
            );
            const result = await dataScienceErrorHandler.getErrorMessageForDisplayInCell(
                new KernelDiedError('Kaboom', 'hello word does not have attribute named abc', undefined, {
                    ...kernelConnection,
                    interpreter: {
                        ...kernelConnection.interpreter!,
                        envType: EnvironmentType.Conda,
                        envName: 'condaEnv1'
                    }
                }),
                'start'
            );
            assert.strictEqual(
                result,
                [
                    "Running cells with 'Hello (Some Path)' requires ipykernel package.",
                    "Run the following command to install 'ipykernel' into the Python environment. ",
                    `Command: 'conda install -n condaEnv1 ipykernel --update-deps --force-reinstall'`
                ].join('\n')
            );
        });
        test('Verify error message for pip install of ipykernel', async () => {
            when(kernelDependencyInstaller.areDependenciesInstalled(anything(), anything(), anything())).thenResolve(
                false
            );
            when(dependencyManager.installMissingDependencies(anything())).thenResolve(
                JupyterInterpreterDependencyResponse.cancel
            );
            const result = await dataScienceErrorHandler.getErrorMessageForDisplayInCell(
                new KernelDiedError(
                    'Kaboom',
                    'hello word does not have attribute named abc',
                    undefined,
                    kernelConnection
                ),
                'start'
            );
            assert.strictEqual(
                result,
                [
                    "Running cells with 'Hello (Some Path)' requires ipykernel package.",
                    "Run the following command to install 'ipykernel' into the Python environment. ",
                    `Command: '"Hello There" -m pip install ipykernel -U --force-reinstall'`
                ].join('\n')
            );
        });
        test('Ensure we provide some context to startup failures', async () => {
            when(dependencyManager.installMissingDependencies(anything())).thenResolve(
                JupyterInterpreterDependencyResponse.cancel
            );
            const result = await dataScienceErrorHandler.getErrorMessageForDisplayInCell(
                new KernelDiedError(
                    'Kaboom',
                    'hello word does not have attribute named abc',
                    undefined,
                    kernelConnection
                ),
                'start'
            );
            assert.strictEqual(
                result,
                [
                    'Failed to start the Kernel. ',
                    'hello word does not have attribute named abc. ',
                    'View Jupyter [log](command:jupyter.viewOutput) for further details.'
                ].join('\n')
            );
        });
        test('Ensure we provide some context to re-start failures', async () => {
            when(dependencyManager.installMissingDependencies(anything())).thenResolve(
                JupyterInterpreterDependencyResponse.cancel
            );
            const result = await dataScienceErrorHandler.getErrorMessageForDisplayInCell(
                new KernelDiedError(
                    'Kaboom',
                    'hello word does not have attribute named abc',
                    undefined,
                    kernelConnection
                ),
                'restart'
            );
            assert.strictEqual(
                result,
                [
                    'Failed to restart the Kernel. ',
                    'hello word does not have attribute named abc. ',
                    'View Jupyter [log](command:jupyter.viewOutput) for further details.'
                ].join('\n')
            );
        });
        function verifyErrorMessage(message: string, linkInfo?: string) {
            message = message.includes('command:jupyter.viewOutput')
                ? message
                : `${message} \n${DataScience.viewJupyterLogForFurtherInfo()}`;
            if (linkInfo) {
                verify(applicationShell.showErrorMessage(message, Common.learnMore())).once();
                verify(browser.launch(linkInfo)).once();
            } else {
                verify(applicationShell.showErrorMessage(message)).once();
            }
        }
    });
});
