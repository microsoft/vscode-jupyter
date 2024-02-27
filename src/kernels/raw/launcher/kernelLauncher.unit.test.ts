// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import * as sinon from 'sinon';
import { KernelLauncher } from './kernelLauncher.node';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IConfigurationService, IDisposable } from '../../../platform/common/types';
import { IProcessServiceFactory } from '../../../platform/common/process/types.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService.node';
import { JupyterPaths } from '../finder/jupyterPaths.node';
import { PythonKernelInterruptDaemon } from '../finder/pythonKernelInterruptDaemon.node';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { anything, instance, mock, when } from 'ts-mockito';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { PythonKernelConnectionMetadata } from '../../types';
import {
    CancellationTokenSource,
    Disposable,
    EventEmitter,
    PortAutoForwardAction,
    Uri,
    type PortAttributesProvider
} from 'vscode';
import { KernelProcess } from './kernelProcess.node';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../platform/interpreter/types.node';
import { UsedPorts } from '../../common/usedPorts';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../test/vscode-mock';

suite('kernel Launcher', () => {
    let disposables: IDisposable[] = [];
    let kernelLauncher: KernelLauncher;
    let processExecutionFactory: IProcessServiceFactory;
    let fs: IFileSystemNode;
    let extensionChecker: IPythonExtensionChecker;
    let kernelEnvVarsService: KernelEnvironmentVariablesService;
    let pythonExecutionFactory: IPythonExecutionFactory;
    let pythonExecService: IPythonExecutionService;
    let configService: IConfigurationService;
    let jupyterPaths: JupyterPaths;
    let pythonKernelInterruptDaemon: PythonKernelInterruptDaemon;
    let platform: IPlatformService;
    setup(() => {
        processExecutionFactory = mock<IProcessServiceFactory>();
        fs = mock<IFileSystemNode>();
        extensionChecker = mock<IPythonExtensionChecker>();
        kernelEnvVarsService = mock<KernelEnvironmentVariablesService>();
        pythonExecutionFactory = mock<IPythonExecutionFactory>();
        configService = mock<IConfigurationService>();
        jupyterPaths = mock<JupyterPaths>();
        pythonKernelInterruptDaemon = mock<PythonKernelInterruptDaemon>();
        platform = mock<IPlatformService>();
        pythonExecService = mock<IPythonExecutionService>();

        (instance(pythonExecService) as any).then = undefined;
        when(pythonExecutionFactory.createActivatedEnvironment(anything())).thenResolve(instance(pythonExecService));
        when(pythonExecService.exec(anything(), anything())).thenResolve({ stdout: '' });
        when(configService.getSettings(anything())).thenReturn({
            jupyter: { logKernelOutputSeparately: false }
        } as any);
        kernelLauncher = new KernelLauncher(
            instance(processExecutionFactory),
            instance(fs),
            instance(extensionChecker),
            instance(kernelEnvVarsService),
            disposables,
            instance(pythonExecutionFactory),
            instance(configService),
            instance(jupyterPaths),
            instance(pythonKernelInterruptDaemon),
            instance(platform)
        );
    });
    teardown(() => {
        disposables = dispose(disposables);
        resetVSCodeMocks();
    });
    async function launchKernel() {
        const kernelSpec = PythonKernelConnectionMetadata.create({
            id: '1',
            interpreter: {
                id: '2',
                uri: Uri.file('python')
            },
            kernelSpec: {
                argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
                display_name: 'Python 3',
                executable: 'python',
                name: 'python3'
            }
        });
        const cancellation = new CancellationTokenSource();
        const launchStub = sinon.stub(KernelProcess.prototype, 'launch');
        const exitedStub = sinon.stub(KernelProcess.prototype, 'exited');
        disposables.push(new Disposable(() => launchStub.restore()));
        disposables.push(new Disposable(() => exitedStub.restore()));
        launchStub.resolves(undefined);
        const exited = new EventEmitter<{
            exitCode?: number | undefined;
            reason?: string | undefined;
        }>();
        exitedStub.get(() => exited.event);
        await kernelLauncher.launch(kernelSpec, 10_000, undefined, __dirname, cancellation.token);
    }
    test('Verify used ports are listed', async () => {
        const oldPorts = Array.from(UsedPorts);

        await launchKernel();

        assert.notDeepEqual(Array.from(UsedPorts), oldPorts, 'Ports not updated');
    });
    test('Verify Kernel ports are not forwarded', async () => {
        const oldPorts = new Set(UsedPorts);
        const providers: PortAttributesProvider[] = [];
        when(mockedVSCodeNamespaces.workspace.registerPortAttributesProvider(anything(), anything())).thenCall(
            (_, provider) => providers.push(provider)
        );

        await launchKernel();
        const cancellation = new CancellationTokenSource();
        disposables.push(cancellation);

        for (const port of UsedPorts) {
            if (oldPorts.has(port)) {
                continue;
            }
            const results = await Promise.all(
                providers.map((p) => Promise.resolve(p.providePortAttributes({ port }, cancellation.token)))
            );
            const portForwardingIgnored = results.some((r) => r?.autoForwardAction === PortAutoForwardAction.Ignore);
            assert.isTrue(portForwardingIgnored, `Kernel Port ${port} should not be forwarded`);
        }
    });
});
