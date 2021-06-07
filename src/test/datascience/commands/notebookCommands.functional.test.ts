// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type { Kernel } from '@jupyterlab/services/lib/kernel/kernel';
import { assert } from 'chai';
import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Uri } from 'vscode';
import { PythonExtensionChecker } from '../../../client/api/pythonApi';
import { ApplicationShell } from '../../../client/common/application/applicationShell';
import { CommandManager } from '../../../client/common/application/commandManager';
import { ICommandManager } from '../../../client/common/application/types';
import { ConfigurationService } from '../../../client/common/configuration/service';
import { NotebookCommands } from '../../../client/datascience/commands/notebookCommands';
import { Commands } from '../../../client/datascience/constants';
import { NotebookProvider } from '../../../client/datascience/interactive-common/notebookProvider';
import { InteractiveWindowProvider } from '../../../client/datascience/interactive-window/interactiveWindowProvider';
import { JupyterNotebookBase } from '../../../client/datascience/jupyter/jupyterNotebook';
import { JupyterSessionManagerFactory } from '../../../client/datascience/jupyter/jupyterSessionManagerFactory';
import { createInterpreterKernelSpec } from '../../../client/datascience/jupyter/kernels/helpers';
import { KernelSelectionProvider } from '../../../client/datascience/jupyter/kernels/kernelSelections';
import { KernelSelector } from '../../../client/datascience/jupyter/kernels/kernelSelector';
import { KernelSwitcher } from '../../../client/datascience/jupyter/kernels/kernelSwitcher';
import {
    IKernelSpecQuickPickItem,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../client/datascience/jupyter/kernels/types';
import { NativeEditorProvider } from '../../../client/datascience/notebookStorage/nativeEditorProvider';
import { PreferredRemoteKernelIdProvider } from '../../../client/datascience/notebookStorage/preferredRemoteKernelIdProvider';
import { InterpreterPackages } from '../../../client/datascience/telemetry/interpreterPackages';
import { IInteractiveWindowProvider, INotebookEditorProvider } from '../../../client/datascience/types';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('DataScience - Notebook Commands', () => {
    let notebookCommands: NotebookCommands;
    let commandManager: ICommandManager;
    let interactiveWindowProvider: IInteractiveWindowProvider;
    let notebookEditorProvider: INotebookEditorProvider;
    let notebookProvider: NotebookProvider;
    let kernelSelectionProvider: KernelSelectionProvider;
    const remoteKernel = {
        lastActivityTime: new Date(),
        name: 'CurrentKernel',
        numberOfConnections: 0,
        id: '2232',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session: {} as any
    };
    const localKernel = {
        name: 'CurrentKernel',
        language: 'python',
        path: 'python',
        display_name: 'CurrentKernel',
        env: {},
        argv: []
    };
    const selectedInterpreter = {
        path: '',
        sysPrefix: '',
        sysVersion: ''
    };
    const remoteSelections: IKernelSpecQuickPickItem<LiveKernelConnectionMetadata>[] = [
        {
            label: 'foobar',
            selection: {
                kernelModel: remoteKernel,
                interpreter: undefined,
                kind: 'connectToLiveKernel',
                id: '0'
            }
        }
    ];
    const localSelections: IKernelSpecQuickPickItem<KernelSpecConnectionMetadata | PythonKernelConnectionMetadata>[] = [
        {
            label: 'foobar',
            selection: {
                kernelSpec: localKernel,
                kernelModel: undefined,
                interpreter: undefined,
                kind: 'startUsingKernelSpec',
                id: '1'
            }
        },
        {
            label: 'foobaz',
            selection: {
                kernelSpec: createInterpreterKernelSpec(selectedInterpreter),
                interpreter: selectedInterpreter,
                kind: 'startUsingPythonInterpreter',
                id: '2'
            }
        }
    ];

    [true, false].forEach((isLocalConnection) => {
        // eslint-disable-next-line
        suite(isLocalConnection ? 'Local Connection' : 'Remote Connection', () => {
            setup(() => {
                interactiveWindowProvider = mock(InteractiveWindowProvider);
                notebookEditorProvider = mock(NativeEditorProvider);
                notebookProvider = mock(NotebookProvider);
                commandManager = mock(CommandManager);

                kernelSelectionProvider = mock(KernelSelectionProvider);
                when(kernelSelectionProvider.getKernelSelections(anything(), anything(), anything())).thenCall(
                    (_a, b, _c) => {
                        if (!b || b.localLaunch) {
                            return localSelections;
                        }
                        return remoteSelections;
                    }
                );
                const appShell = mock(ApplicationShell);
                const jupyterSessionManagerFactory = mock(JupyterSessionManagerFactory);
                const dummySessionEvent = new EventEmitter<Kernel.IKernelConnection>();
                const preferredKernelIdProvider = mock(PreferredRemoteKernelIdProvider);
                when(jupyterSessionManagerFactory.onRestartSessionCreated).thenReturn(dummySessionEvent.event);
                when(jupyterSessionManagerFactory.onRestartSessionUsed).thenReturn(dummySessionEvent.event);
                when(appShell.showQuickPick(anything(), anything(), anything())).thenCall(() => {
                    return isLocalConnection ? localSelections[0] : remoteSelections[0];
                });
                when(appShell.withProgress(anything(), anything())).thenCall((_o, t) => {
                    return t();
                });
                when(notebookProvider.connect(anything())).thenResolve(
                    isLocalConnection ? ({ type: 'raw' } as any) : ({ type: 'jupyter' } as any)
                );

                const configService = mock(ConfigurationService);
                // eslint-disable-next-line
                const settings = { jupyterServerType: isLocalConnection ? 'local' : 'remote' };
                when(configService.getSettings(anything())).thenReturn(settings as any);
                const extensionChecker = mock(PythonExtensionChecker);
                when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
                when(preferredKernelIdProvider.getPreferredRemoteKernelId(anything())).thenResolve();
                when(preferredKernelIdProvider.storePreferredRemoteKernelId(anything(), anything())).thenResolve();
                const kernelSelector = new KernelSelector(
                    instance(kernelSelectionProvider),
                    instance(appShell),
                    instance(configService),
                    instance(mock(InterpreterPackages))
                );

                const kernelSwitcher = new KernelSwitcher(instance(configService), instance(appShell), kernelSelector);

                notebookCommands = new NotebookCommands(
                    instance(commandManager),
                    instance(notebookEditorProvider),
                    instance(interactiveWindowProvider),
                    instance(notebookProvider),
                    kernelSelector,
                    kernelSwitcher,
                    instance(configService)
                );
            });

            function createNotebookMock() {
                const obj = mock(JupyterNotebookBase);
                when((obj as any).then).thenReturn(undefined);
                return obj;
            }
            function verifyCallToSetKernelSpec(notebook: JupyterNotebookBase) {
                verify(notebook.setKernelConnection(anything(), anything())).once();

                const kernelConnection = capture(notebook.setKernelConnection).first()[0];
                if (isLocalConnection) {
                    assert.equal(kernelConnection.kind, 'startUsingKernelSpec');
                    const kernelSpec =
                        kernelConnection.kind !== 'connectToLiveKernel' ? kernelConnection.kernelSpec : undefined;
                    assert.equal(kernelSpec?.name, localKernel.name);
                } else {
                    assert.equal(kernelConnection.kind, 'connectToLiveKernel');
                    const kernelModel =
                        kernelConnection.kind === 'connectToLiveKernel' ? kernelConnection.kernelModel : undefined;
                    assert.equal(kernelModel?.name, remoteKernel.name);
                }
            }

            test('Register Command', () => {
                notebookCommands.register();

                verify(
                    commandManager.registerCommand(Commands.SwitchJupyterKernel, anything(), notebookCommands)
                ).once();
            });
            suite('Command Handler', () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let commandHandler: Function;
                setup(() => {
                    notebookCommands.register();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    commandHandler = capture(commandManager.registerCommand as any).first()[1] as Function;
                    commandHandler = commandHandler.bind(notebookCommands);
                });
                test('Should not switch if no identity', async () => {
                    await commandHandler.bind(notebookCommands)();
                    verify(kernelSelectionProvider.getKernelSelections(anything(), anything())).never();
                });
                test('Should switch kernel using the provided notebook', async () => {
                    const notebook = createNotebookMock();
                    when((notebook as any).then).thenReturn(undefined);
                    const uri = Uri.file('test.ipynb');
                    when(notebookProvider.getOrCreateNotebook(anything())).thenCall(async () => {
                        return instance(notebook);
                    });

                    await commandHandler.bind(notebookCommands)({ identity: uri });

                    verifyCallToSetKernelSpec(notebook);
                });
                test('Should switch kernel using the active Native Editor', async () => {
                    const nativeEditor = createNotebookMock();
                    const uri = Uri.file('test.ipynb');
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    when(notebookEditorProvider.activeEditor).thenReturn({
                        file: uri,
                        model: { metadata: undefined }
                    } as any);
                    when(notebookProvider.getOrCreateNotebook(anything())).thenResolve(instance(nativeEditor));

                    await commandHandler.bind(notebookCommands)();

                    verifyCallToSetKernelSpec(nativeEditor);
                });
                test('Should switch kernel using the active Interactive Window', async () => {
                    const interactiveWindow = createNotebookMock();
                    const uri = Uri.parse('history://foobar');
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    when(interactiveWindowProvider.activeWindow).thenReturn({
                        identity: uri
                    } as any);
                    when(notebookProvider.getOrCreateNotebook(anything())).thenResolve(instance(interactiveWindow));

                    await commandHandler.bind(notebookCommands)();

                    verifyCallToSetKernelSpec(interactiveWindow);
                });
                test('Should switch kernel using the active Native editor even if an Interactive Window is available', async () => {
                    const uri1 = Uri.parse('history://foobar');
                    const nativeEditor = createNotebookMock();
                    const uri2 = Uri.parse('test.ipynb');
                    when(notebookEditorProvider.activeEditor).thenReturn({
                        file: uri2,
                        model: { metadata: undefined }
                    } as any);
                    when(interactiveWindowProvider.activeWindow).thenReturn({
                        identity: uri1
                    } as any);
                    when(notebookProvider.getOrCreateNotebook(anything())).thenCall(async (o) => {
                        if (o.identity === uri2) {
                            return instance(nativeEditor);
                        }
                    });

                    await commandHandler.bind(notebookCommands)();

                    verifyCallToSetKernelSpec(nativeEditor);
                });
                test('With no notebook, should still fire change', async () => {
                    when(notebookProvider.getOrCreateNotebook(anything())).thenResolve(undefined);
                    const uri = Uri.parse('history://foobar');
                    await commandHandler.bind(notebookCommands)({ identity: uri });
                    verify(notebookProvider.firePotentialKernelChanged(anything(), anything())).once();
                });
            });
        });
    });
});
