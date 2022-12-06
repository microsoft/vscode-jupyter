// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
export const __ = '';
// import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
// import { EventEmitter } from 'vscode';
// import { IExtensionSingleActivationService } from '../../platform/activation/types';
// import { PythonExtensionChecker } from '../../platform/api/pythonApi';
// import { PythonExecutionFactory } from '../../platform/common/process/pythonExecutionFactory';
// import { IPythonExecutionFactory } from '../../platform/common/process/types';
// import { sleep } from '../../platform/common/utils/async';
// import { Activation } from '../../platform/datascience/activation';
// import { JupyterDaemonModule } from '../../platform/datascience/constants';
// import { ActiveEditorContextService } from '../../platform/datascience/commands/activeEditorContext';
// import { JupyterInterpreterService } from '../../platform/datascience/jupyter/interpreter/jupyterInterpreterService';
// import { KernelDaemonPreWarmer } from '../../platform/datascience/kernel-launcher/kernelDaemonPreWarmer';
// import {
//     INotebookCreationTracker,
//     INotebookEditor,
//     INotebookEditorProvider,
//     IRawNotebookSupportedService
// } from '../../platform/datascience/types';
// import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
// import { FakeClock } from '../common';
// import { createPythonInterpreter } from '../utils/interpreters';

// suite('Activation', () => {
//     let activator: IExtensionSingleActivationService;
//     let notebookEditorProvider: INotebookEditorProvider;
//     let jupyterInterpreterService: JupyterInterpreterService;
//     let executionFactory: IPythonExecutionFactory;
//     let openedEventEmitter: EventEmitter<INotebookEditor>;
//     let interpreterEventEmitter: EventEmitter<PythonEnvironment>;
//     let contextService: ActiveEditorContextService;
//     let fakeTimer: FakeClock;
//     const interpreter = createPythonInterpreter();

//     setup(async () => {
//         fakeTimer = new FakeClock();
//         openedEventEmitter = new EventEmitter<INotebookEditor>();
//         interpreterEventEmitter = new EventEmitter<PythonEnvironment>();
//         const tracker = mock<INotebookCreationTracker>();

//         notebookEditorProvider = mock(NativeEditorProvider);
//         jupyterInterpreterService = mock(JupyterInterpreterService);
//         executionFactory = mock(PythonExecutionFactory);
//         contextService = mock(ActiveEditorContextService);
//         const daemonPool = mock(KernelDaemonPreWarmer);
//         when(notebookEditorProvider.onDidOpenNotebookEditor).thenReturn(openedEventEmitter.event);
//         when(jupyterInterpreterService.onDidChangeInterpreter).thenReturn(interpreterEventEmitter.event);
//         when(executionFactory.createDaemon(anything())).thenResolve();
//         when(contextService.activate()).thenResolve();
//         when(daemonPool.activate(anything())).thenResolve();
//         const extensionChecker = mock(PythonExtensionChecker);
//         const rawNotebook = mock<IRawNotebookSupportedService>();
//         when(rawNotebook.supported()).thenReturn(false);
//         when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
//         when(extensionChecker.isPythonExtensionActive).thenReturn(true);
//         activator = new Activation(
//             instance(notebookEditorProvider),
//             instance(jupyterInterpreterService),
//             instance(executionFactory),
//             [],
//             instance(contextService),
//             instance(daemonPool),
//             instance(rawNotebook),
//             instance(tracker),
//             instance(extensionChecker)
//         );
//         when(jupyterInterpreterService.getSelectedInterpreter()).thenResolve(interpreter);
//         when(jupyterInterpreterService.getSelectedInterpreter(anything())).thenResolve(interpreter);
//         when(jupyterInterpreterService.setInitialInterpreter()).thenResolve(interpreter);
//         await activator.activate();
//     });
//     teardown(() => fakeTimer.uninstall());
//     async function testCreatingDaemonWhenOpeningANotebook() {
//         fakeTimer.install();
//         const notebook: INotebookEditor = mock(NativeEditor);

//         // Open a notebook, (fire the event).
//         openedEventEmitter.fire(notebook);

//         // Wait for debounce to complete.
//         await fakeTimer.wait();

//         verify(executionFactory.createDaemon(anything())).once();
//         verify(
//             executionFactory.createDaemon(
//                 deepEqual({ daemonModule: JupyterDaemonModule, pythonPath: interpreter.path })
//             )
//         ).once();
//     }

//     test('Create a daemon when a notebook is opened', async () => testCreatingDaemonWhenOpeningANotebook());

//     test('Create a daemon when changing interpreter after a notebook has beeen opened', async () => {
//         await testCreatingDaemonWhenOpeningANotebook();

//         // Trigger changes to interpreter.
//         interpreterEventEmitter.fire(interpreter);

//         // Wait for debounce to complete.
//         await fakeTimer.wait();

//         verify(
//             executionFactory.createDaemon(
//                 deepEqual({ daemonModule: JupyterDaemonModule, pythonPath: interpreter.path })
//             )
//         ).twice();
//     });
//     test('Changing interpreter without opening a notebook does not result in a daemon being created', async () => {
//         // Trigger changes to interpreter.
//         interpreterEventEmitter.fire(interpreter);

//         // Assume a debounce is required and wait.
//         await sleep(10);

//         verify(executionFactory.createDaemon(anything())).never();
//     });
// });
