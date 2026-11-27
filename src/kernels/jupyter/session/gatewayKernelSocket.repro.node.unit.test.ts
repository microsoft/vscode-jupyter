// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, local-rules/dont-use-process */

/**
 * Repro for https://github.com/microsoft/vscode-jupyter/issues/17509
 *
 * Requires a live Jupyter server running in gateway mode (whose kernel websocket does not negotiate
 * the `v1.kernel.websocket.jupyter.org` sub-protocol), e.g.
 *   jupyter enterprisegateway --ip=127.0.0.1 --port=18888
 *   jupyter server --GatewayClient.url=http://127.0.0.1:18888 --ServerApp.token=test --port=18889
 *
 * Environment variables:
 *   JUPYTER_17509_SERVER_URL   e.g. http://127.0.0.1:18889 (test is skipped when not set)
 *   JUPYTER_17509_TOKEN        e.g. test
 *   JUPYTER_17509_WS8_PATH     path to a `ws@8` package, used to mimic the WebSocket ctor injected by
 *                              the ms-toolsai.jupyter-hub extension (`class OurWebSocket extends isomorphic-ws`)
 */

import { assert } from 'chai';
import { EventEmitter, NotebookDocument, Uri } from 'vscode';
import { raceTimeout } from '../../../platform/common/utils/async';
import { JupyterRequestCreator } from './jupyterRequestCreator.node';
import { IPyWidgetMessageDispatcher } from '../../../notebooks/controllers/ipywidgets/message/ipyWidgetMessageDispatcher';
import { KernelSocketMap } from '../../kernelSocket';
import { registerLogger } from '../../../platform/logging';
import { ILogger } from '../../../platform/logging/types';
import { IKernel, IKernelProvider } from '../../types';

const serverUrl = process.env.JUPYTER_17509_SERVER_URL;
const token = process.env.JUPYTER_17509_TOKEN || '';
const ws8Path = process.env.JUPYTER_17509_WS8_PATH;

suite('Issue 17509 repro - gateway mode remote kernel', function () {
    this.timeout(120_000);
    const errors: string[] = [];
    const logs: string[] = [];
    let disposeLogger: { dispose(): void } | undefined;
    const toDispose: { dispose(): void }[] = [];

    suiteSetup(function () {
        if (!serverUrl) {
            return this.skip();
        }
    });
    setup(() => {
        errors.length = 0;
        logs.length = 0;
        const capture =
            (level: string) =>
            (message: string, ...data: unknown[]) => {
                const line = `[${level}] ${message}${data.length ? ' ' + data.map((d) => String(d)).join(' ') : ''}`;
                logs.push(line);
                if (level === 'error') {
                    errors.push(line);
                }
            };
        const captureLogger: ILogger = {
            error: capture('error'),
            warn: capture('warn'),
            info: capture('info'),
            debug: () => undefined,
            trace: () => undefined,
            ci: () => undefined
        };
        disposeLogger = registerLogger(captureLogger);
    });
    teardown(() => {
        disposeLogger?.dispose();
        while (toDispose.length) {
            toDispose.pop()!.dispose();
        }
    });

    async function createRemoteKernel() {
        const fetch = require('node-fetch');
        const res = await fetch(`${serverUrl}/api/kernels?token=${token}`, {
            method: 'POST',
            body: JSON.stringify({ name: 'python3' }),
            headers: { 'Content-Type': 'application/json' }
        });
        const body = await res.text();
        assert.isTrue(res.ok, `Failed to start kernel ${res.status} ${body}`);
        return JSON.parse(body) as { id: string; name: string };
    }

    async function runScenario(webSocketCtor: any, label: string) {
        const { ServerConnection } = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
        const { KernelConnection } =
            require('@jupyterlab/services/lib/kernel/default') as typeof import('@jupyterlab/services/lib/kernel/default');
        const requestCreator = new JupyterRequestCreator();
        const settings = ServerConnection.makeSettings({
            baseUrl: serverUrl!,
            appUrl: '',
            wsUrl: serverUrl!.replace('http', 'ws'),
            token,
            appendToken: true,
            init: requestCreator.getRequestInit(),
            WebSocket: webSocketCtor,
            fetch: requestCreator.getFetchMethod() as any,
            Request: requestCreator.getRequestCtor(undefined, false, undefined),
            Headers: requestCreator.getHeadersCtor()
        });

        const model = await createRemoteKernel();
        const kernel = new KernelConnection({ model, serverSettings: settings, handleComms: true });
        toDispose.push({ dispose: () => kernel.dispose() });

        // Wait for the connection to be established (this includes the fallback reconnect with no sub-protocol).
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`[${label}] kernel never connected (${kernel.connectionStatus})`)),
                30_000
            );
            const check = () => {
                if (kernel.connectionStatus === 'connected') {
                    clearTimeout(timer);
                    resolve();
                }
            };
            kernel.connectionStatusChanged.connect(check);
            check();
        });
        const socket = KernelSocketMap.get(kernel.id)!;
        console.log(`[${label}] connected, socket.protocol=${JSON.stringify(socket?.protocol)}`);

        // Attach the real IPyWidgets receive/send hooks, exactly as the extension does after the kernel starts.
        const sessionSocketChange = new EventEmitter<void>();
        const fakeKernel = {
            session: { kernel, onDidKernelSocketChange: sessionSocketChange.event },
            onRestarted: () => ({ dispose: () => undefined }),
            onDisposed: () => ({ dispose: () => undefined })
        } as unknown as IKernel;
        const startEmitter = new EventEmitter<{ notebook: NotebookDocument }>();
        const kernelProvider = {
            get: () => fakeKernel,
            onDidStartKernel: startEmitter.event
        } as unknown as IKernelProvider;
        const document = { uri: Uri.file('test.ipynb') } as unknown as NotebookDocument;
        const dispatcher = new IPyWidgetMessageDispatcher(kernelProvider, document);
        toDispose.push(dispatcher);

        // Record what the receive hook actually receives.
        const hookPayloadTypes: string[] = [];
        socket.addReceiveHook(async (data) => {
            hookPayloadTypes.push(
                typeof data === 'string'
                    ? 'string'
                    : Buffer.isBuffer(data)
                    ? 'Buffer'
                    : Object.prototype.toString.call(data)
            );
        });
        startEmitter.fire({ notebook: document });

        // Run print("hello") and wait for the execute reply.
        const stdout: string[] = [];
        const future = kernel.requestExecute({ code: 'print("hello")' });
        future.onIOPub = (msg) => {
            if (msg.header.msg_type === 'stream') {
                stdout.push((msg.content as any).text);
            }
        };
        const outcome = await raceTimeout<string>(
            15_000,
            'timed out after 15s',
            future.done.then(
                (reply) => `done: ${reply.content.status}`,
                (error: unknown) => `failed: ${String(error)}`
            )
        );

        console.log(`[${label}] execute outcome: ${outcome}`);
        console.log(`[${label}] stdout: ${JSON.stringify(stdout)}`);
        console.log(`[${label}] kernel status: ${kernel.status}, connectionStatus: ${kernel.connectionStatus}`);
        console.log(`[${label}] receive hook payload types: ${JSON.stringify(Array.from(new Set(hookPayloadTypes)))}`);
        console.log(`[${label}] captured logs:\n  ${logs.join('\n  ')}`);

        assert.deepEqual(
            errors.filter((e) => e.includes('Exception while handling messages')),
            [],
            'Messages were dropped by the KernelSocketWrapper receive hooks'
        );
        assert.match(outcome, /^done: ok/, 'print("hello") did not complete');
        assert.deepEqual(stdout, ['hello\n']);
    }

    test('WebSocket injected by jupyter-hub (ws@8, wrapWebSocketCtor)', async function () {
        if (!ws8Path) {
            return this.skip();
        }
        const WS8 = require(ws8Path);
        // Mimics ms-toolsai.jupyter-hub `OurWebSocket extends WebSocketIsomorphic` (isomorphic-ws -> ws@^8).
        class OurWebSocket extends WS8 {}
        const ctor = new JupyterRequestCreator().wrapWebSocketCtor(OurWebSocket as any);
        await runScenario(ctor, 'jupyter-hub/ws8');
    });

    test('Built-in WebSocket (bundled ws, getWebsocketCtor)', async function () {
        const ctor = new JupyterRequestCreator().getWebsocketCtor(undefined, false, undefined);
        await runScenario(ctor, 'builtin/ws');
    });
});
