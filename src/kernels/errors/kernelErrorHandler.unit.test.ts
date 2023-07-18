// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import dedent from 'dedent';
import { assert } from 'chai';
import { anything, capture, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Uri, WorkspaceFolder } from 'vscode';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../../platform/common/application/types';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { Common, DataScience } from '../../platform/common/utils/localize';
import { IBrowserService, IConfigurationService, IExtensions } from '../../platform/common/types';
import {
    IKernelDependencyService,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse,
    PythonKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../types';
import { PythonEnvironment, EnvironmentType } from '../../platform/pythonEnvironments/info';
import { JupyterInterpreterService } from '../jupyter/interpreter/jupyterInterpreterService.node';
import { DataScienceErrorHandler } from './kernelErrorHandler';
import { JupyterConnectError } from '../../platform/errors/jupyterConnectError';
import { JupyterInstallError } from '../../platform/errors/jupyterInstallError';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError';
import { KernelDiedError } from './kernelDiedError';
import {
    IJupyterInterpreterDependencyManager,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration,
    JupyterInterpreterDependencyResponse,
    JupyterServerProviderHandle
} from '../jupyter/types';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { getOSType, OSType } from '../../platform/common/utils/platform';
import { RemoteJupyterServerConnectionError } from '../../platform/errors/remoteJupyterServerConnectionError';
import { computeServerId, generateUriFromRemoteProvider } from '../jupyter/jupyterUtils';
import { RemoteJupyterServerUriProviderError } from './remoteJupyterServerUriProviderError';
import { IReservedPythonNamedProvider } from '../../platform/interpreter/types';
import { DataScienceErrorHandlerNode } from './kernelErrorHandler.node';
import { IFileSystem } from '../../platform/common/platform/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';

suite('Error Handler Unit Tests', () => {
    let applicationShell: IApplicationShell;
    let dataScienceErrorHandler: DataScienceErrorHandler;
    let dependencyManager: IJupyterInterpreterDependencyManager;
    let workspaceService: IWorkspaceService;
    let browser: IBrowserService;
    let configuration: IConfigurationService;
    let jupyterInterpreterService: JupyterInterpreterService;
    let kernelDependencyInstaller: IKernelDependencyService;
    let uriStorage: IJupyterServerUriStorage;
    let jupyterUriProviderRegistration: IJupyterUriProviderRegistration;
    let cmdManager: ICommandManager;
    let extensions: IExtensions;
    let reservedPythonNames: IReservedPythonNamedProvider;
    let fs: IFileSystem;
    let interpreterService: IInterpreterService;
    const jupyterInterpreter: PythonEnvironment = {
        displayName: 'Hello',
        uri: Uri.file('Some Path'),
        id: Uri.file('Some Path').fsPath,
        sysPrefix: ''
    };

    setup(() => {
        applicationShell = mock<IApplicationShell>();
        workspaceService = mock<IWorkspaceService>();
        dependencyManager = mock<IJupyterInterpreterDependencyManager>();
        configuration = mock<IConfigurationService>();
        browser = mock<IBrowserService>();
        uriStorage = mock<IJupyterServerUriStorage>();
        cmdManager = mock<ICommandManager>();
        jupyterInterpreterService = mock<JupyterInterpreterService>();
        jupyterUriProviderRegistration = mock<IJupyterUriProviderRegistration>();
        extensions = mock<IExtensions>();
        extensions = mock<IExtensions>();
        interpreterService = mock<IInterpreterService>();
        fs = mock<IFileSystem>();
        when(dependencyManager.installMissingDependencies(anything())).thenResolve();
        when(workspaceService.workspaceFolders).thenReturn([]);
        kernelDependencyInstaller = mock<IKernelDependencyService>();
        when(kernelDependencyInstaller.areDependenciesInstalled(anything(), anything(), anything())).thenResolve(true);
        when(extensions.getExtension(anything())).thenReturn({ packageJSON: { displayName: '' } } as any);
        when(fs.exists(anything())).thenResolve(true);
        reservedPythonNames = mock<IReservedPythonNamedProvider>();
        when(reservedPythonNames.isReserved(anything())).thenResolve(false);
        when(interpreterService.refreshInterpreters(anything())).thenResolve();
        dataScienceErrorHandler = new DataScienceErrorHandlerNode(
            instance(applicationShell),
            instance(dependencyManager),
            instance(browser),
            instance(configuration),
            instance(kernelDependencyInstaller),
            instance(workspaceService),
            instance(uriStorage),
            false,
            instance(extensions),
            instance(jupyterUriProviderRegistration),
            instance(reservedPythonNames),
            instance(fs),
            instance(interpreterService)
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
                DataScience.jupyterSelfCertEnable,
                DataScience.jupyterSelfCertClose
            )
        ).never();
    });

    test('Jupyter Install Error', async () => {
        when(
            applicationShell.showInformationMessage(
                anything(),
                DataScience.jupyterInstall,
                DataScience.notebookCheckForImportNo,
                anything()
            )
        ).thenResolve(DataScience.jupyterInstall as any);

        const err = new JupyterInstallError(message);
        await dataScienceErrorHandler.handleError(err);

        verify(dependencyManager.installMissingDependencies(err)).once();
    });

    suite('Kernel startup errors', () => {
        let kernelConnection: KernelConnectionMetadata;
        const uri = generateUriFromRemoteProvider('1', 'a');
        let serverId: string;
        const serverProviderHandle: JupyterServerProviderHandle = {
            handle: '1',
            id: 'a'
        };
        suiteSetup(async () => {
            serverId = await computeServerId(uri);
        });
        setup(() => {
            when(applicationShell.showErrorMessage(anything(), Common.learnMore)).thenResolve(Common.learnMore as any);
            kernelConnection = PythonKernelConnectionMetadata.create({
                id: '',
                interpreter: {
                    uri: Uri.file('Hello There'),
                    id: Uri.file('Hello There').fsPath,
                    sysPrefix: 'Something else',
                    displayName: 'Hello (Some Path)'
                },
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    executable: ''
                }
            });
        });
        const stdErrorMessages = {
            userOverridingRandomPyFile_Unix: dedent`
                Info 14:45:47: KernelProcess Exit Exit - 1 Traceback (most recent call last):
                File "/home/xyz/.pyenv/versions/3.8.12/lib/python3.8/runpy.py", line 194, in _run_module_as_main
                    return _run_code(code, main_globals, None,
                File "/home/xyz/.pyenv/versions/3.8.12/lib/python3.8/runpy.py", line 87, in _run_code
                    exec(code, run_globals)
                File "/home/xyz/samples/pySamples/sample/.venvNoIPythonGenUtils/lib/python3.8/site-packages/ipykernel_launcher.py", line 15, in <module>
                    from ipykernel import kernelapp as app
                File "/home/xyz/samples/pySamples/sample/.venvNoIPythonGenUtils/lib/python3.8/site-packages/ipykernel/__init__.py", line 2, in <module>
                    from .connect import *
                File "/home/xyz/samples/pySamples/sample/.venvNoIPythonGenUtils/lib/python3.8/site-packages/ipykernel/connect.py", line 10, in <module>
                    import jupyter_client
                File "/home/xyz/samples/pySamples/sample/.venvNoIPythonGenUtils/lib/python3.8/site-packages/jupyter_client/__init__.py", line 6, in <module>
                    from .asynchronous import AsyncKernelClient  # noqa
                File "/home/xyz/samples/pySamples/sample/.venvNoIPythonGenUtils/lib/python3.8/site-packages/jupyter_client/asynchronous/__init__.py", line 1, in <module>
                    from .client import AsyncKernelClient  # noqa
                File "/home/xyz/samples/pySamples/sample/.venvNoIPythonGenUtils/lib/python3.8/site-packages/jupyter_client/asynchronous/client.py", line 6, in <module>
                    from jupyter_client.channels import HBChannel
                File "/home/xyz/samples/pySamples/sample/.venvNoIPythonGenUtils/lib/python3.8/site-packages/jupyter_client/channels.py", line 4, in <module>
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
                ImportError: cannot import name 'Template' from 'string' (/home/xyz/samples/pySamples/sample/kernel_crash/no_start/string.py)
                `,
            userOverridingRandomPyFile_Windows: `
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
            userOverridingXmlPyFile_Linux: `
                Info 14:16:26: Cancel pending cells
                Info 14:16:26: KernelProcess Exit Exit - 1 Traceback (most recent call last):\n' +
                '  File "/opt/homebrew/Cellar/python@3.9/3.9.13_1/Frameworks/Python.framework/Versions/3.9/lib/python3.9/runpy.py", line 197, in _run_module_as_main\n' +
                '    return _run_code(code, main_globals, None,\n' +
                '  File "/opt/homebrew/Cellar/python@3.9/3.9.13_1/Frameworks/Python.framework/Versions/3.9/lib/python3.9/runpy.py", line 87, in _run_code\n' +
                '    exec(code, run_globals)\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/ipykernel_launcher.py", line 15, in <module>\n' +
                '    from ipykernel import kernelapp as app\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/ipykernel/kernelapp.py", line 18, in <module>\n' +
                '    from IPython.core.application import (\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/IPython/__init__.py", line 53, in <module>\n' +
                '    from .terminal.embed import embed\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/IPython/terminal/embed.py", line 16, in <module>\n' +
                '    from IPython.terminal.interactiveshell import TerminalInteractiveShell\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/IPython/terminal/interactiveshell.py", line 29, in <module>\n' +
                '    from prompt_toolkit.auto_suggest import AutoSuggestFromHistory\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/prompt_toolkit/__init__.py", line 16, in <module>\n' +
                '    from .application import Application\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/prompt_toolkit/application/__init__.py", line 1, in <module>\n' +
                '    from .application import Application\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/prompt_toolkit/application/application.py", line 41, in <module>\n' +
                '    from prompt_toolkit.buffer import Buffer\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/prompt_toolkit/buffer.py", line 36, in <module>\n' +
                '    from .completion import (\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/prompt_toolkit/completion/__init__.py", line 1, in <module>\n' +
                '    from .base import (\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/prompt_toolkit/completion/base.py", line 9, in <module>\n' +
                '    from prompt_toolkit.formatted_text import AnyFormattedText, StyleAndTextTuples\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/prompt_toolkit/formatted_text/__init__.py", line 23, in <module>\n' +
                '    from .html import HTML\n' +
                '  File "/Users/MyUserName/sample/.venvWidgets/lib/python3.9/site-packages/prompt_toolkit/formatted_text/html.py", line 1, in <module>\n' +
                '    import xml.dom.minidom as minidom\n' +
                "ModuleNotFoundError: No module named 'xml.dom'; 'xml' is not a package\n"
                `,
            failureToStartJupyter: `namespace, args = self._parse_known_args(args, namespace)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 2062, in _parse_known_args
                    start_index = consume_optional(start_index)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 2002, in consume_optional
                    take_action(action, args, option_string)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 1930, in take_action
                    action(self, namespace, argument_values, option_string)
                File "/home/don/samples/pySamples/sample/.venvJupyter/lib/python3.9/site-packages/traitlets/config/loader.py", line 913, in __call__
                    raise NotImplementedError("subclasses must implement __call__")
                NotImplementedError: subclasses must implement __call__`,
            failureToStartJupyterDueToOutdatedTraitlets: `namespace, args = self._parse_known_args(args, namespace)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 2062, in _parse_known_args
                    start_index = consume_optional(start_index)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 2002, in consume_optional
                    take_action(action, args, option_string)
                File "/home/don/miniconda3/envs/tf/lib/python3.9/argparse.py", line 1930, in take_action
                    action(self, namespace, argument_values, option_string)
                File "/home/don/samples/pySamples/sample/.venvJupyter/lib/python3.9/site-packages/traitlets/config/loader.py", line 913, in __call__
                    raise NotImplementedError("subclasses must implement __call__")
                AttributeError: 'Namespace' object has no attribute '_flags'`
        };
        test('Unable to import <name> from user overriding module (windows)', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOverridingRandomPyFile_Windows,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined,
                'jupyterExtension'
            );

            const expectedMessage = DataScience.failedToStartKernelDueToImportFailureFromFile(
                'Random',
                'c:\\Development\\samples\\pySamples\\sample1\\kernel_issues\\start\\random.py'
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
                    stdErrorMessages.userOverridingRandomPyFile_Windows,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined,
                'jupyterExtension'
            );

            const expectedMessage = DataScience.fileSeemsToBeInterferingWithKernelStartup(
                getDisplayPath(
                    Uri.file('c:\\Development\\samples\\pySamples\\sample1\\kernel_issues\\start\\random.py'),
                    workspaceFolders
                )
            );

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresOverridingBuiltInModules');
        });
        test('Module not found due to user file overriding overriding a module', async () => {
            const workspaceFolders: WorkspaceFolder[] = [
                {
                    index: 0,
                    name: '',
                    uri: Uri.file('/Users/MyUserName/sample/kernel_issues')
                }
            ];
            when(workspaceService.workspaceFolders).thenReturn(workspaceFolders);
            when(reservedPythonNames.getUriOverridingReservedPythonNames(anything())).thenResolve([
                { uri: Uri.file('/Users/MyUserName/sample/kernel_issues/xml.py'), type: 'file' }
            ]);
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOverridingXmlPyFile_Linux,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                Uri.file('/Users/MyUserName/sample/kernel_issues'),
                'jupyterExtension'
            );

            const expectedMessage = DataScience.fileSeemsToBeInterferingWithKernelStartup('xml.py');

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresOverridingBuiltInModules');
        });
        test('Module not found due to user module with __init__.py overriding overriding a module', async () => {
            const workspaceFolders: WorkspaceFolder[] = [
                {
                    index: 0,
                    name: '',
                    uri: Uri.file('/Users/MyUserName/sample/kernel_issues')
                }
            ];
            when(workspaceService.workspaceFolders).thenReturn(workspaceFolders);
            when(reservedPythonNames.getUriOverridingReservedPythonNames(anything())).thenResolve([
                { uri: Uri.file('/Users/MyUserName/sample/kernel_issues/xml/__init__.py'), type: '__init__' }
            ]);
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOverridingXmlPyFile_Linux,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                Uri.file('/Users/MyUserName/sample/kernel_issues'),
                'jupyterExtension'
            );

            const expectedMessage = DataScience.failedToStartKernelDueToMissingModule('xml.dom');

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresMissingModule');
        });
        test('Module not found and missing module is not overridden by user files', async () => {
            const workspaceFolders: WorkspaceFolder[] = [
                {
                    index: 0,
                    name: '',
                    uri: Uri.file('/Users/MyUserName/sample/kernel_issues')
                }
            ];
            when(workspaceService.workspaceFolders).thenReturn(workspaceFolders);
            // Lets mark everything as not being reserved, in this case, we should not
            // treat files such as xml.py as overriding the builtin python modules
            when(reservedPythonNames.getUriOverridingReservedPythonNames(anything())).thenResolve([]);
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOverridingXmlPyFile_Linux,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                Uri.file('/Users/MyUserName/sample/kernel_issues'),
                'jupyterExtension'
            );

            const expectedMessage = DataScience.failedToStartKernelDueToMissingModule('xml.dom');

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresMissingModule');
        });
        test('Unable to import <name> from user overriding module (linux)', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOverridingRandomPyFile_Unix,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined,
                'jupyterExtension'
            );

            const expectedMessage = DataScience.failedToStartKernelDueToImportFailureFromFile(
                'Template',
                '/home/xyz/samples/pySamples/sample/kernel_crash/no_start/string.py' // Not using getDisplayPath under the covers
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
                    uri: Uri.file('/home/xyz/samples/pySamples/sample/')
                }
            ];
            when(workspaceService.workspaceFolders).thenReturn(workspaceFolders);
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError(
                    'Hello',
                    stdErrorMessages.userOverridingRandomPyFile_Unix,
                    undefined,
                    kernelConnection
                ),
                'start',
                kernelConnection,
                undefined,
                'jupyterExtension'
            );

            const expectedMessage = DataScience.fileSeemsToBeInterferingWithKernelStartup(
                getDisplayPath(
                    Uri.file('/home/xyz/samples/pySamples/sample/kernel_crash/no_start/string.py'),
                    workspaceFolders
                )
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
                undefined,
                'jupyterExtension'
            );

            const expectedMessage = DataScience.failedToStartKernelDueToWin32APIFailure;

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
                undefined,
                'jupyterExtension'
            );

            const expectedMessage = DataScience.failedToStartKernelDueToImportFailure('xyz');

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
                undefined,
                'jupyterExtension'
            );

            const expectedMessage = DataScience.failedToStartKernelDueToPyZmqFailure;

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresPyzmq');
        });
        test('Unknown Dll load failure', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError('Hello', `ImportError: DLL load failed`, undefined, kernelConnection),
                'start',
                kernelConnection,
                undefined,
                'jupyterExtension'
            );

            const expectedMessage = DataScience.failedToStartKernelDueToUnknownDllLoadFailure;

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresDllLoad');
        });
        test('Dll load failure', async () => {
            await dataScienceErrorHandler.handleKernelError(
                new KernelDiedError('Hello', `import XYZ\nImportError: DLL load failed`, undefined, kernelConnection),
                'start',
                kernelConnection,
                undefined,
                'jupyterExtension'
            );

            const expectedMessage = DataScience.failedToStartKernelDueToDllLoadFailure('XYZ');

            verifyErrorMessage(expectedMessage, 'https://aka.ms/kernelFailuresDllLoad');
        });

        async function verifyJupyterErrors(stdError: string, expectedMessage: string, expectedLink?: string) {
            when(jupyterInterpreterService.getSelectedInterpreter()).thenResolve(jupyterInterpreter);
            when(jupyterInterpreterService.getSelectedInterpreter(anything())).thenResolve(jupyterInterpreter);
            await dataScienceErrorHandler.handleKernelError(
                new JupyterConnectError(stdError, `xyz`),
                'start',
                kernelConnection,
                undefined,
                'jupyterExtension'
            );

            verifyErrorMessage(expectedMessage, expectedLink);
        }
        test('Failure to start Jupyter Server (unable to extract python error message)', async () => {
            const envDisplayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
            const expectedMessage = DataScience.failedToStartJupyter(envDisplayName);
            await verifyJupyterErrors('Kaboom', expectedMessage);
        });
        test('Failure to start Jupyter Server (unable to extract python error message), (without failure about jupyter error, without daemon)', async () => {
            const envDisplayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
            const expectedMessage = DataScience.failedToStartJupyter(envDisplayName);
            await verifyJupyterErrors('kaboom', expectedMessage);
        });
        test('Failure to start Jupyter Server', async () => {
            const stdError = `${stdErrorMessages.failureToStartJupyter}

Failed to run jupyter as observable with args notebook --no-browser --notebook-dir="/home/don/samples/pySamples/sample" --config=/tmp/40aa74ae-d668-4225-8201-4570c9a0ac4a/jupyter_notebook_config.py --NotebookApp.iopub_data_rate_limit=10000000000.0`;
            const envDisplayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
            const pythonError = 'NotImplementedError: subclasses must implement __call__';
            const expectedMessage = DataScience.failedToStartJupyterWithErrorInfo(envDisplayName, pythonError);
            await verifyJupyterErrors(stdError, expectedMessage);
        });
        test('Failure to start Jupyter Server (without failure about jupyter error, without daemon)', async () => {
            const stdError = stdErrorMessages.failureToStartJupyter;
            const envDisplayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
            const pythonError = 'NotImplementedError: subclasses must implement __call__';
            const expectedMessage = DataScience.failedToStartJupyterWithErrorInfo(envDisplayName, pythonError);
            await verifyJupyterErrors(stdError, expectedMessage);
        });
        test('Failure to start Jupyter Server due to outdated traitlets', async () => {
            const stdError = `${stdErrorMessages.failureToStartJupyterDueToOutdatedTraitlets}

Failed to run jupyter as observable with args notebook --no-browser --notebook-dir="/home/don/samples/pySamples/sample" --config=/tmp/40aa74ae-d668-4225-8201-4570c9a0ac4a/jupyter_notebook_config.py --NotebookApp.iopub_data_rate_limit=10000000000.0`;
            const envDisplayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
            const pythonError = "AttributeError: 'Namespace' object has no attribute '_flags'";
            const expectedMessage = DataScience.failedToStartJupyterDueToOutdatedTraitlets(envDisplayName, pythonError);

            await verifyJupyterErrors(
                stdError,
                expectedMessage,
                'https://aka.ms/kernelFailuresJupyterTrailtletsOutdated'
            );
        });
        test('Failure to start Jupyter Server due to outdated traitlets (without failure about jupyter error, without daemon)', async () => {
            const stdError = stdErrorMessages.failureToStartJupyterDueToOutdatedTraitlets;
            const envDisplayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
            const pythonError = "AttributeError: 'Namespace' object has no attribute '_flags'";
            const expectedMessage = DataScience.failedToStartJupyterDueToOutdatedTraitlets(envDisplayName, pythonError);
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
                undefined,
                'jupyterExtension'
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
                undefined,
                'jupyterExtension'
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
                undefined,
                'jupyterExtension'
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
                'start',
                undefined
            );
            assert.strictEqual(
                result,
                [
                    "Running cells with 'Hello (Some Path)' requires the ipykernel package.",
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
                'start',
                undefined
            );
            const command =
                getOSType() === OSType.Windows
                    ? `Command: '"Hello There" -m pip install ipykernel -U --force-reinstall'`
                    : `Command: '"/Hello There" -m pip install ipykernel -U --force-reinstall'`;

            assert.strictEqual(
                result,
                [
                    "Running cells with 'Hello (Some Path)' requires the ipykernel package.",
                    "Run the following command to install 'ipykernel' into the Python environment. ",
                    command
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
                'start',
                undefined
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
                'restart',
                undefined
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
        test('Display error when connection to remote jupyter server fails', async () => {
            const error = new RemoteJupyterServerConnectionError(uri, serverId, new Error('ECONNRESET error'));
            const connection = RemoteKernelSpecConnectionMetadata.create({
                baseUrl: 'http://hello:1234/',
                id: '1',
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    executable: ''
                },
                serverId,
                serverProviderHandle
            });
            when(
                applicationShell.showErrorMessage(anything(), anything(), anything(), anything(), anything())
            ).thenResolve();

            const result = await dataScienceErrorHandler.handleKernelError(
                error,
                'start',
                connection,
                undefined,
                'jupyterExtension'
            );
            assert.strictEqual(result, KernelInterpreterDependencyResponse.cancel);
            verify(
                applicationShell.showErrorMessage(
                    DataScience.remoteJupyterConnectionFailedWithServer(error.baseUrl),
                    deepEqual({ detail: error.originalError.message || '', modal: true }),
                    DataScience.removeRemoteJupyterConnectionButtonText,
                    DataScience.changeRemoteJupyterConnectionButtonText,
                    DataScience.selectDifferentKernel
                )
            ).once();
            verify(uriStorage.remove(deepEqual(serverProviderHandle))).never();
        });
        test('Display error when connection to remote jupyter server fails due to 3rd party extension', async () => {
            const error = new RemoteJupyterServerUriProviderError('1', 'a', new Error('invalid handle'), serverId);
            const connection = RemoteKernelSpecConnectionMetadata.create({
                baseUrl: 'http://hello:1234/',
                id: '1',
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    executable: ''
                },
                serverId,
                serverProviderHandle
            });
            when(uriStorage.get(serverId)).thenResolve({
                time: 1,
                uri,
                serverId,
                displayName: 'Hello Server',
                provider: { id: '1', handle: 'a' }
            });
            when(
                applicationShell.showErrorMessage(anything(), anything(), anything(), anything(), anything())
            ).thenResolve();

            const result = await dataScienceErrorHandler.handleKernelError(
                error,
                'start',
                connection,
                undefined,
                'jupyterExtension'
            );
            assert.strictEqual(result, KernelInterpreterDependencyResponse.cancel);
            verify(
                applicationShell.showErrorMessage(
                    DataScience.remoteJupyterConnectionFailedWithServer('Hello Server'),
                    deepEqual({ detail: error.originalError.message || '', modal: true }),
                    DataScience.removeRemoteJupyterConnectionButtonText,
                    DataScience.changeRemoteJupyterConnectionButtonText,
                    DataScience.selectDifferentKernel
                )
            ).once();
            verify(uriStorage.remove(deepEqual(serverProviderHandle))).never();
            verify(uriStorage.get(serverId)).atLeast(1);
        });
        test('Remove remote Uri if user choses to do so, when connection to remote jupyter server fails', async () => {
            const error = new RemoteJupyterServerConnectionError(uri, serverId, new Error('ECONNRESET error'));
            const connection = RemoteKernelSpecConnectionMetadata.create({
                baseUrl: 'http://hello:1234/',
                id: '1',
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    executable: '' // Send nothing for argv[0]
                },
                serverId,
                serverProviderHandle
            });
            when(
                applicationShell.showErrorMessage(anything(), anything(), anything(), anything(), anything())
            ).thenResolve(DataScience.removeRemoteJupyterConnectionButtonText as any);
            when(uriStorage.remove(anything())).thenResolve();
            when(uriStorage.get(serverId)).thenResolve({ uri, serverId, time: 2, provider: serverProviderHandle });
            when(uriStorage.get(deepEqual(serverProviderHandle))).thenResolve({
                uri,
                serverId,
                time: 2,
                provider: serverProviderHandle
            });
            const result = await dataScienceErrorHandler.handleKernelError(
                error,
                'start',
                connection,
                undefined,
                'jupyterExtension'
            );
            assert.strictEqual(result, KernelInterpreterDependencyResponse.cancel);
            verify(uriStorage.remove(deepEqual(serverProviderHandle))).once();
            verify(uriStorage.get(serverId)).atLeast(1);
        });
        test('Change remote Uri if user choses to do so, when connection to remote jupyter server fails', async () => {
            const error = new RemoteJupyterServerConnectionError(uri, serverId, new Error('ECONNRESET error'));
            const connection = RemoteKernelSpecConnectionMetadata.create({
                baseUrl: 'http://hello:1234/',
                id: '1',
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    executable: ''
                },
                serverId,
                serverProviderHandle
            });
            when(
                applicationShell.showErrorMessage(anything(), anything(), anything(), anything(), anything())
            ).thenResolve(DataScience.changeRemoteJupyterConnectionButtonText as any);
            when(cmdManager.executeCommand(anything(), anything(), anything(), anything())).thenResolve();
            const result = await dataScienceErrorHandler.handleKernelError(
                error,
                'start',
                connection,
                undefined,
                'jupyterExtension'
            );
            assert.strictEqual(result, KernelInterpreterDependencyResponse.cancel);
            verify(uriStorage.remove(deepEqual(serverProviderHandle))).never();
        });
        test('Select different kernel user choses to do so, when connection to remote jupyter server fails', async () => {
            const error = new RemoteJupyterServerConnectionError(uri, serverId, new Error('ECONNRESET error'));
            const connection = RemoteKernelSpecConnectionMetadata.create({
                baseUrl: 'http://hello:1234/',
                id: '1',
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    executable: ''
                },
                serverId,
                serverProviderHandle
            });
            when(
                applicationShell.showErrorMessage(anything(), anything(), anything(), anything(), anything())
            ).thenResolve(DataScience.selectDifferentKernel as any);
            const result = await dataScienceErrorHandler.handleKernelError(
                error,
                'start',
                connection,
                undefined,
                'jupyterExtension'
            );
            assert.strictEqual(result, KernelInterpreterDependencyResponse.selectDifferentKernel);
            verify(uriStorage.remove(deepEqual(serverProviderHandle))).never();
        });
        function verifyErrorMessage(message: string, linkInfo?: string) {
            message = message.includes('command:jupyter.viewOutput')
                ? message
                : `${message} \n${DataScience.viewJupyterLogForFurtherInfo}`;
            if (linkInfo) {
                verify(applicationShell.showErrorMessage(anything(), Common.learnMore)).once;
            } else {
                verify(applicationShell.showErrorMessage(anything())).once();
            }
            const displayedMessage = capture(applicationShell.showErrorMessage).first();
            assert.strictEqual(displayedMessage[0], message);
            if (linkInfo) {
                verify(browser.launch(anything())).once();
                assert.strictEqual(capture(browser.launch).first()[0], linkInfo);
            }
        }
    });
});
