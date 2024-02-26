// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { getNotebookCellOutputMetadata } from './helpers';
import { IKernelSession } from '../types';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { IDisposable } from '../../platform/common/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { CodeExecution } from './codeExecution';
import { IKernelConnection } from '@jupyterlab/services/lib/kernel/kernel';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import {
    IDisplayDataMsg,
    IErrorMsg,
    IExecuteReplyMsg,
    IExecuteRequestMsg,
    IExecuteResultMsg,
    IStreamMsg,
    IUpdateDisplayDataMsg
} from '@jupyterlab/services/lib/kernel/messages';
import { Deferred, createDeferred } from '../../platform/common/utils/async';
import { NotebookCellOutput, NotebookCellOutputItem } from 'vscode';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../test/constants';

suite('Code Execution', () => {
    let disposables: IDisposable[] = [];
    let session: IKernelSession;
    let kernel: IKernelConnection;
    let request: Kernel.IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>;
    let requestDone: Deferred<KernelMessage.IExecuteReplyMsg>;
    const successExecutionContent: IExecuteReplyMsg = {
        channel: 'shell',
        content: {
            execution_count: 1,
            status: 'ok',
            user_expressions: {}
        },
        header: {
            msg_id: '1',
            msg_type: 'execute_reply',
            session: '1',
            username: '1',
            date: new Date().toString(),
            version: '1'
        },
        metadata: {} as any,
        parent_header: {} as any
    };
    setup(() => {
        session = mock<IKernelSession>();
        kernel = mock<IKernelConnection>();
        request = mock<Kernel.IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg>>();
        requestDone = createDeferred<KernelMessage.IExecuteReplyMsg>();

        when(request.dispose()).thenReturn();
        when(request.done).thenReturn(requestDone.promise);
        when(session.kernel).thenReturn(instance(kernel));
        when(session.isDisposed).thenReturn(false);
        when(kernel.isDisposed).thenReturn(false);
        when(kernel.requestExecute(anything(), true)).thenReturn(instance(request));
    });
    teardown(() => {
        disposables = dispose(disposables);
    });
    function createExecution(code: string, extensionId: string) {
        const execution = CodeExecution.fromCode(code, extensionId);
        disposables.push(execution);

        when(session.kernel);
        return execution;
    }

    test('Verify execution', async () => {
        const code = `print('Hello World')`;
        const execution = createExecution(code, 'ext1');

        const outputs: NotebookCellOutput[] = [];
        disposables.push(execution.onDidEmitOutput((output) => outputs.push(output)));
        void execution.start(instance(session));

        requestDone.resolve(successExecutionContent);
        await execution.result;
    });
    test('Verify execution failure bubbles up', async () => {
        const code = `print('Hello World')`;
        const execution = createExecution(code, 'ext1');

        const outputs: NotebookCellOutput[] = [];
        disposables.push(execution.onDidEmitOutput((output) => outputs.push(output)));
        void execution.start(instance(session));

        requestDone.resolve({
            channel: 'shell',
            content: {
                status: 'error',
                execution_count: 1,
                ename: 'NameError',
                evalue: 'NameError: name "foo" is not defined',
                traceback: []
            },
            header: {
                msg_id: '1',
                msg_type: 'execute_reply',
                session: '1',
                username: '1',
                date: new Date().toString(),
                version: '1'
            },
            metadata: {} as any,
            parent_header: {} as any
        });

        await assert.isRejected(execution.result, 'NameError: name "foo" is not defined');
    });
    test('Verify execution fails with error output', async () => {
        const code = `print('Hello World')`;
        const execution = createExecution(code, 'ext1');

        const outputs: NotebookCellOutput[] = [];
        disposables.push(execution.onDidEmitOutput((output) => outputs.push(output)));
        void execution.start(instance(session));

        // Execution result
        void instance(request).onIOPub(<IErrorMsg>{
            channel: 'iopub',
            content: { ename: 'NotFoundError', evalue: 'Not Found', traceback: [] },
            header: {
                msg_id: '1',
                msg_type: 'error',
                session: '1',
                username: '1',
                date: new Date().toString(),
                version: '1'
            },
            metadata: {} as any,
            parent_header: {} as any
        });

        requestDone.resolve(successExecutionContent);
        await execution.result;

        assert.strictEqual(outputs.length, 1, 'Incorrect number of outputs');
        assert.strictEqual(outputs[0].items.length, 1, 'Incorrect number of items');
        assert.strictEqual(outputs[0].items[0].mime, NotebookCellOutputItem.error(new Error('')).mime);
        const error = JSON.parse(new TextDecoder().decode(outputs[0].items[0].data));
        assert.strictEqual(error.name, 'NotFoundError');
        assert.strictEqual(error.message, 'Not Found');
    });
    test('Verify execute result', async () => {
        const code = `print('Hello World')`;
        const execution = createExecution(code, 'ext1');

        const outputs: NotebookCellOutput[] = [];
        disposables.push(execution.onDidEmitOutput((output) => outputs.push(output)));
        void execution.start(instance(session));

        // Execution result
        void instance(request).onIOPub(<IExecuteResultMsg>{
            channel: 'iopub',
            content: { execution_count: 1, data: {} },
            header: {
                msg_id: '1',
                msg_type: 'execute_result',
                session: '1',
                username: '1'
            },
            metadata: {} as any,
            parent_header: {} as any
        });

        requestDone.resolve(successExecutionContent);
        await execution.result;

        assert.strictEqual(outputs.length, 1, 'Incorrect number of outputs');
        assert.strictEqual(outputs[0].items.length, 0, 'Incorrect number of items');
    });
    test('Verify stream result', async () => {
        const code = `print('Hello World')`;
        const execution = createExecution(code, 'ext1');

        const outputs: NotebookCellOutput[] = [];
        disposables.push(execution.onDidEmitOutput((output) => outputs.push(output)));
        void execution.start(instance(session));

        // Stream output
        void instance(request).onIOPub(<IStreamMsg>{
            channel: 'iopub',
            content: { name: 'stdout', text: 'Hello World' },
            header: {
                msg_id: '1',
                msg_type: 'stream',
                session: '1',
                username: '1'
            },
            metadata: {} as any,
            parent_header: {} as any
        });

        requestDone.resolve(successExecutionContent);
        await execution.result;

        assert.strictEqual(outputs.length, 1, 'Incorrect number of outputs');
        assert.strictEqual(outputs[0].items.length, 1, 'Incorrect number of items');
        assert.strictEqual(
            outputs[0].items[0].mime,
            NotebookCellOutputItem.stdout('').mime,
            'Incorrect number of items'
        );
        assert.strictEqual(
            new TextDecoder().decode(outputs[0].items[0].data),
            'Hello World',
            'Incorrect number of items'
        );
    });
    test('Verify display data result', async () => {
        const code = `print('Hello World')`;
        const execution = createExecution(code, 'ext1');

        const outputs: NotebookCellOutput[] = [];
        disposables.push(execution.onDidEmitOutput((output) => outputs.push(output)));
        void execution.start(instance(session));

        // Stream output
        void instance(request).onIOPub(<IDisplayDataMsg>{
            channel: 'iopub',
            content: {
                data: { 'text/plain': 'Hello World', 'application/vnd.custom': { one: 1, two: 2 } },
                metadata: { foo: 'bar' },
                transient: { display_id: '1234' }
            },
            header: {
                msg_id: '1',
                msg_type: 'display_data',
                session: '1',
                username: '1',
                date: new Date().toString(),
                version: '1'
            },
            metadata: {} as any,
            parent_header: {} as any
        });

        requestDone.resolve(successExecutionContent);
        await execution.result;

        assert.strictEqual(outputs.length, 1, 'Incorrect number of outputs');
        assert.strictEqual(outputs[0].items.length, 2, 'Incorrect number of items');
        assert.strictEqual(outputs[0].items[0].mime, 'application/vnd.custom');
        assert.strictEqual(outputs[0].items[1].mime, 'text/plain');
        assert.strictEqual(new TextDecoder().decode(outputs[0].items[0].data), JSON.stringify({ one: 1, two: 2 }));
        assert.strictEqual(new TextDecoder().decode(outputs[0].items[1].data), 'Hello World');

        const metadata = getNotebookCellOutputMetadata(outputs[0]);
        assert.strictEqual(metadata?.transient?.display_id, '1234');
        assert.deepEqual(metadata?.metadata, { foo: 'bar' });
    });
    test('Verify display data update result', async () => {
        const code = `print('Hello World')`;
        const execution = createExecution(code, 'ext1');

        const outputs: NotebookCellOutput[] = [];
        disposables.push(execution.onDidEmitOutput((output) => outputs.push(output)));
        void execution.start(instance(session));

        // Stream output
        void instance(request).onIOPub(<IUpdateDisplayDataMsg>{
            channel: 'iopub',
            content: {
                data: { 'text/plain': 'Hello World', 'application/vnd.custom': { one: 1, two: 2 } },
                metadata: { foo: 'bar' },
                transient: { display_id: '1234' }
            },
            header: {
                msg_id: '1',
                msg_type: 'update_display_data',
                session: '1',
                username: '1',
                date: new Date().toString(),
                version: '1'
            },
            metadata: {} as any,
            parent_header: {} as any
        });

        requestDone.resolve(successExecutionContent);
        await execution.result;

        assert.strictEqual(outputs.length, 1, 'Incorrect number of outputs');
        assert.strictEqual(outputs[0].items.length, 2, 'Incorrect number of items');
        assert.strictEqual(outputs[0].items[0].mime, 'application/vnd.custom');
        assert.strictEqual(outputs[0].items[1].mime, 'text/plain');
        assert.strictEqual(new TextDecoder().decode(outputs[0].items[0].data), JSON.stringify({ one: 1, two: 2 }));
        assert.strictEqual(new TextDecoder().decode(outputs[0].items[1].data), 'Hello World');

        const metadata = getNotebookCellOutputMetadata(outputs[0]);
        assert.strictEqual(metadata?.transient?.display_id, '1234');
        assert.deepEqual(metadata?.metadata, { foo: 'bar' });
    });

    test('Cancelling pending 3rd party execution code should interrupt the kernel', async () => {
        const code = `print('Hello World')`;
        const execution = createExecution(code, 'ext1');

        const outputs: NotebookCellOutput[] = [];
        disposables.push(execution.onDidEmitOutput((output) => outputs.push(output)));
        void execution.start(instance(session));

        when(kernel.interrupt()).thenCall(() => {
            requestDone.resolve(successExecutionContent);
            return Promise.resolve();
        });

        await execution.cancel();

        verify(kernel.interrupt()).once();
        verify(request.dispose()).calledAfter(kernel.interrupt());
    });
    test('Cancelling pending Internal Jupyter execution code should not interrupt the kernel', async () => {
        const code = `print('Hello World')`;
        const execution = createExecution(code, JVSC_EXTENSION_ID_FOR_TESTS);

        const outputs: NotebookCellOutput[] = [];
        disposables.push(execution.onDidEmitOutput((output) => outputs.push(output)));
        void execution.start(instance(session));

        when(request.dispose()).thenCall(() => {
            requestDone.resolve(successExecutionContent);
            return;
        });

        await execution.cancel();

        verify(kernel.interrupt()).never();
        verify(request.dispose());
    });
});
