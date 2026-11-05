// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { instance, mock, when, anything } from 'ts-mockito';
import { EventEmitter, Memento, NotebookDocument, Uri, WorkspaceConfiguration } from 'vscode';
import { PythonExtension } from '@vscode/python-extension';
import * as sinon from 'sinon';
import { Kernel } from '../../kernels/kernel';
import { KernelStartupTelemetry } from '../../kernels/kernelStartupTelemetry.node';
import { IKernel, IKernelController, IKernelProvider, LocalKernelSpecConnectionMetadata } from '../../kernels/types';
import { IKernelConnection, IKernelLauncher, IKernelProcess } from '../../kernels/raw/types';
import { RawSessionConnection } from '../../kernels/raw/session/rawSessionConnection.node';
import { RawJupyterSessionWrapper } from '../../kernels/raw/session/rawJupyterSession.node';
import { setPythonApi } from '../../platform/interpreter/helpers';
import { noop } from '../../platform/common/utils/misc';
import { generateUuid } from '../../platform/common/uuid';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../vscode-mock';
import { resolvableInstance } from './helpers';

export interface RawStartupTestBackend {
    readonly interpreter: string;
    readonly connection: IKernelConnection;
    createProcess(metadata: LocalKernelSpecConnectionMetadata): IKernelProcess;
    stop(): Promise<void>;
}

export function initializeRawStartupTestApi() {
    resetVSCodeMocks();
    const config = mock<WorkspaceConfiguration>();
    when(config.get(anything(), anything())).thenCall((_key: string, fallback: unknown) => fallback);
    when(mockedVSCodeNamespaces.workspace.getConfiguration(anything())).thenReturn(instance(config));
    const api = mock<PythonExtension>();
    const environments = mock<PythonExtension['environments']>();
    when(api.environments).thenReturn(instance(environments));
    when(environments.known).thenReturn([]);
    setPythonApi(instance(api));
    const stub = sinon.stub(PythonExtension, 'api').resolves(resolvableInstance(api));
    return { dispose: () => stub.restore() };
}

export function createRawStartupTestContext<T extends RawStartupTestBackend>(
    initialFixture: T,
    launchTimeout = 3000,
    nextFixture?: () => Promise<T>,
    language = 'python'
) {
    const uri = Uri.file(`C:\\fixture\\${generateUuid()}.ipynb`);
    const metadata = LocalKernelSpecConnectionMetadata.create({
        id: generateUuid(),
        kernelSpec: {
            argv: [initialFixture.interpreter],
            executable: initialFixture.interpreter,
            name: 'python3',
            display_name: 'Fixture',
            language
        },
        interpreter:
            language === 'python' ? { id: 'fixture-python', uri: Uri.file(initialFixture.interpreter) } : undefined
    });
    let currentFixture = initialFixture;
    let launches = 0;
    const fixtures = [initialFixture];
    const sessions: { raw: RawSessionConnection; wrapped: RawJupyterSessionWrapper }[] = [];
    const launcher: IKernelLauncher = {
        async launch() {
            if (launches++ > 0) {
                if (!nextFixture) {
                    throw new Error('A restart requires a fresh owned test backend');
                }
                currentFixture = await nextFixture();
                fixtures.push(currentFixture);
            }
            return currentFixture.createProcess(metadata);
        }
    };
    const notebook = mock<NotebookDocument>();
    when(notebook.uri).thenReturn(uri);
    const kernel = new Kernel(
        uri,
        instance(notebook),
        metadata,
        {
            async create(options) {
                const raw = new RawSessionConnection(
                    uri,
                    launcher,
                    Uri.file('C:\\fixture'),
                    metadata,
                    launchTimeout,
                    'notebook'
                );
                const wrapped = new RawJupyterSessionWrapper(raw, uri, metadata);
                sessions.push({ raw, wrapped });
                await raw.startKernel({ token: options.token });
                return wrapped;
            }
        },
        {
            launchTimeout,
            interruptTimeout: 1000,
            enableExtendedPythonKernelCompletions: false,
            themeMatplotlibPlots: false,
            runStartupCommands: []
        },
        instance(mock<IKernelController>()),
        [],
        instance(mock<Memento>()),
        undefined,
        { isSupported: true }
    );
    const created = new EventEmitter<IKernel>();
    const provider = mock<IKernelProvider>();
    when(provider.onDidCreateKernel).thenReturn(created.event);
    const subscriptions: { dispose(): void }[] = [];
    new KernelStartupTelemetry(instance(provider), subscriptions).activate();
    created.fire(kernel);
    return {
        kernel,
        sessions,
        fixtures,
        get fixture() {
            return currentFixture;
        },
        async dispose() {
            void kernel.dispose().catch(noop);
            await Promise.all(sessions.map((session) => session.raw.shutdown()));
            await Promise.all(fixtures.map((fixture) => fixture.stop()));
            subscriptions.forEach((item) => item.dispose());
            created.dispose();
        }
    };
}
