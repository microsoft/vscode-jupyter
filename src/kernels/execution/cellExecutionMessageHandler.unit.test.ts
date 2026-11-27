// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { createMockedNotebookDocument } from '../../test/datascience/editor-integration/helpers';
import {
    CancellationTokenSource,
    EventEmitter,
    NotebookCell,
    NotebookCellData,
    NotebookCellExecution,
    NotebookCellKind,
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookDocument,
    NotebookDocumentChangeEvent,
    NotebookRange
} from 'vscode';
import { Identifiers, PYTHON_LANGUAGE, RendererExtension, WIDGET_MIMETYPE } from '../../platform/common/constants';
import dedent from 'dedent';
import { dispose } from '../../platform/common/utils/lifecycle';
import { createDeferred } from '../../platform/common/utils/async';
import { IKernelController } from '../types';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { instance, mock, when } from 'ts-mockito';
import type { IDisplayData, IDisplayUpdate } from '@jupyterlab/nbformat';
import { CellExecutionMessageHandlerService } from './cellExecutionMessageHandlerService';
import { createKernelController } from '../../test/datascience/notebook/executionHelper';
import { getTextOutputValue, translateCellDisplayOutput } from './helpers';
import {
    IFakeSocket,
    MsgIdProducer,
    createKernelConnection,
    createMessageProducers
} from '../../test/datascience/fakeKernelConnection.node';
import { JupyterRequestCreator } from '../jupyter/session/jupyterRequestCreator.node';
import { waitForCondition } from '../../test/common';
import { mockedVSCodeNamespaces } from '../../test/vscode-mock';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { NotebookCellExecutionWrapper } from './cellExecutionCreator';

suite(`Cell Execution Message Handler`, async () => {
    let disposables: IDisposable[] = [];
    let controller: IKernelController;
    let context: IExtensionContext;
    let kernel: Kernel.IKernelConnection;
    let fakeSocket: IFakeSocket;
    let messageHandlerService: CellExecutionMessageHandlerService;
    let tokenSource: CancellationTokenSource;
    let messageHandlingFailure: undefined | Error;
    const msgIdProducer = new MsgIdProducer();

    function createNotebook(cells: NotebookCellData[]) {
        const notebook = createMockedNotebookDocument(cells);
        Object.defineProperty(notebook, 'isClosed', { value: false, configurable: true });
        messageHandlerService = new CellExecutionMessageHandlerService(controller, instance(context), [], notebook);
        disposables.push(messageHandlerService);
        return notebook;
    }
    function sendRequest(cell: NotebookCell, code: string, cellExecution?: NotebookCellExecution) {
        const request = kernel.requestExecute({
            code,
            allow_stdin: true,
            silent: false,
            stop_on_error: true,
            store_history: true
        });
        const producer = createMessageProducers(msgIdProducer).forExecRequest(request);
        const handler = cellExecution
            ? messageHandlerService.registerListenerForExecution(cell, { kernel, request, cellExecution })
            : messageHandlerService.registerListenerForResumingExecution(cell, {
                  kernel,
                  msg_id: request.msg.header.msg_id,
                  cellExecution: controller.createNotebookCellExecution(cell)
              });
        handler.onErrorHandlingExecuteRequestIOPubMessage(
            (ex) => (messageHandlingFailure = ex.error),
            undefined,
            disposables
        );
        disposables.push(handler);
        return { request, producer, handler };
    }

    setup(() => {
        msgIdProducer.reset();
        messageHandlingFailure = undefined;
        tokenSource = new CancellationTokenSource();
        disposables.push(tokenSource);
        controller = createKernelController();
        context = mock<IExtensionContext>();
        const fakes = createKernelConnection(new JupyterRequestCreator());
        kernel = fakes.connection;
        fakeSocket = fakes.socket;
    });
    teardown(() => (disposables = dispose(disposables)));

    suite('Display Updates', () => {
        const display_id = 'displayIdXYZ';
        const display_id2 = 'displayIdXYZ_2';
        const imageCell = dedent`
                        from base64 import b64decode
                        from IPython.display import Image, display
                        img = b64decode('iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==')
                        h = display(Image(img, width=50, height=50), display_id=True)
                        `;
        const imageOutput: IDisplayData = {
            data: {
                'image/png':
                    'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==',
                'text/plain': ['<IPython.core.display.Image object>']
            },
            metadata: {
                'image/png': {
                    height: 50,
                    width: 50
                }
            },
            output_type: 'display_data'
        };
        const emptyDisplayDataOutput: IDisplayData = {
            data: {},
            metadata: {},
            output_type: 'display_data'
        };
        const imageUpdateOutput: IDisplayUpdate = {
            data: {
                'image/png':
                    'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==',
                'text/plain': ['<IPython.core.display.Image object>']
            },
            metadata: {
                'image/png': {
                    height: 500,
                    width: 500
                }
            },
            output_type: 'update_display_data'
        };
        const addDisplayDataOutput = dedent`
        from IPython.display import display
        dh = display(display_id=True)
        dh`;
        const codeToUpdateDisplayDataHello = dedent`
                from IPython.display import Markdown
                dh.update(Markdown("Hello"))
                `;
        const codeToUpdateDisplayDataWorld = dedent`
                from IPython.display import Markdown
                dh.update(Markdown("World"))
                `;
        const outputsFromHelloUpdate: IDisplayUpdate = {
            data: {
                'text/markdown': 'Hello',
                'text/plain': '<IPython.core.display.Markdown object>'
            },
            transient: {
                display_id: display_id
            },
            metadata: {},
            output_type: 'update_display_data'
        };
        const outputsFromWorldUpdate: IDisplayUpdate = {
            data: {
                'text/markdown': 'World',
                'text/plain': '<IPython.core.display.Markdown object>'
            },
            transient: {
                display_id: display_id
            },
            metadata: {},
            output_type: 'update_display_data'
        };

        const codeForTwoDisplayUpdates = dedent`
                                            from IPython.display import display, HTML, Markdown
                                            dh = display(Markdown("Hello"), display_id=True)
                                            dh2 = display(Markdown("World"), display_id=True)
                                            `;
        const codeToUpdateDisplayData1ILike = 'dh.update(Markdown("I Like"))';
        const codeToUpdateDisplayData1Pizza = 'dh.update(Markdown("Pizza"))';
        const outputsForTwoDisplayDataHelloWorld: IDisplayData[] = [
            {
                data: {
                    'text/markdown': 'Hello',
                    'text/plain': '<IPython.core.display.Markdown object>'
                },
                transient: {
                    display_id: display_id
                },
                metadata: {},
                output_type: 'display_data'
            },
            {
                data: {
                    'text/markdown': 'World',
                    'text/plain': '<IPython.core.display.Markdown object>'
                },
                transient: {
                    display_id: display_id2
                },
                metadata: {},
                output_type: 'display_data'
            }
        ];
        const outputsFromILikeUpdate: IDisplayUpdate = {
            data: {
                'text/markdown': 'I Like',
                'text/plain': '<IPython.core.display.Markdown object>'
            },
            transient: {
                display_id: display_id
            },
            metadata: {},
            output_type: 'update_display_data'
        };
        const outputsFromPizzaUpdate: IDisplayUpdate = {
            data: {
                'text/markdown': 'Pizza',
                'text/plain': '<IPython.core.display.Markdown object>'
            },
            transient: {
                display_id: display_id2
            },
            metadata: {},
            output_type: 'update_display_data'
        };

        async function executeCellWithOutput(
            cell: NotebookCell,
            code: string,
            executionCount: number,
            messageGenerator: (
                producer: ReturnType<ReturnType<typeof createMessageProducers>['forExecRequest']>
            ) => KernelMessage.IMessage<KernelMessage.MessageType>[],
            cellExecution?: NotebookCellExecution
        ) {
            // Now update the display data of the first cell from the second cell
            const { request, producer, handler } = sendRequest(cell, code, cellExecution);

            fakeSocket.emitOnMessage(producer.status('busy'));
            fakeSocket.emitOnMessage(producer.execInput(executionCount));
            messageGenerator(producer).forEach((msg) => fakeSocket.emitOnMessage(msg));
            fakeSocket.emitOnMessage(producer.status('idle'));
            fakeSocket.emitOnMessage(producer.reply(executionCount));

            await request.done;

            assert.isUndefined(messageHandlingFailure);
            return handler;
        }

        type Producer = ReturnType<ReturnType<typeof createMessageProducers>['forExecRequest']>;

        function display(text: string, id = display_id): KernelMessage.IUpdateDisplayDataMsg['content'] {
            return { data: { 'text/plain': text }, metadata: {}, transient: { display_id: id } };
        }

        function trackingId(output: NotebookCellOutput): unknown {
            return (output.metadata as { _vscode?: { trackingId?: unknown } } | undefined)?._vscode?.trackingId;
        }

        function widgetOpen(producer: Producer, commId: string): KernelMessage.ICommOpenMsg<'iopub'> {
            const template = producer.displayOutput(display(''));
            return {
                ...template,
                header: { ...template.header, msg_type: 'comm_open' },
                content: {
                    comm_id: commId,
                    target_name: Identifiers.DefaultCommTarget,
                    data: { state: { _model_module: '@jupyter-widgets/output' } }
                }
            };
        }

        function widgetCapture(producer: Producer, commId: string): KernelMessage.ICommMsgMsg<'iopub'> {
            const template = producer.displayOutput(display(''));
            const parent = template.parent_header;
            if (!('msg_id' in parent) || typeof parent.msg_id !== 'string') {
                throw new Error('Expected an execute request parent');
            }
            return {
                ...template,
                header: { ...template.header, msg_type: 'comm_msg' },
                content: { comm_id: commId, data: { method: 'update', state: { msg_id: parent.msg_id } } }
            };
        }

        function clearOutput(producer: Producer, wait = false): KernelMessage.IClearOutputMsg {
            const template = producer.displayOutput(display(''));
            return {
                ...template,
                header: { ...template.header, msg_type: 'clear_output' },
                content: { wait }
            };
        }

        function executeResult(producer: Producer, text: string, id?: string): KernelMessage.IExecuteResultMsg {
            const template = producer.displayOutput({
                data: { 'text/plain': text },
                metadata: {},
                ...(id ? { transient: { display_id: id } } : {})
            });
            return {
                ...template,
                header: { ...template.header, msg_type: 'execute_result' },
                content: { ...template.content, execution_count: 1 }
            };
        }

        function createTestExecution(cell: NotebookCell, clearOnStart = false) {
            return new NotebookCellExecutionWrapper(
                controller.createNotebookCellExecution(cell),
                controller.id,
                () => undefined,
                clearOnStart
            );
        }

        async function runMessages(
            cell: NotebookCell,
            messages: (producer: Producer) => KernelMessage.IMessage[],
            executionCount = 1
        ) {
            const execution = createTestExecution(cell);
            const handler = await executeCellWithOutput(cell, 'execute', executionCount, messages, execution);
            await handler.completed;
            execution.end(true);
            assert.isUndefined(messageHandlingFailure);
        }

        async function runUpdates(
            cell: NotebookCell,
            values: readonly (string | KernelMessage.IUpdateDisplayDataMsg['content'])[],
            executionCount = 1
        ) {
            await runMessages(
                cell,
                (producer) =>
                    values.map((value) => producer.displayUpdate(typeof value === 'string' ? display(value) : value)),
                executionCount
            );
        }

        async function show(cell: NotebookCell, text: string, executionCount = 1) {
            await runMessages(cell, (producer) => [producer.displayOutput(display(text))], executionCount);
        }

        function mapped(cell: NotebookCell, id = display_id) {
            return CellOutputDisplayIdTracker.getMappedOutput(cell.notebook, id);
        }

        function createDisplayTestHost(cellCount = 3) {
            const changes = new EventEmitter<NotebookDocumentChangeEvent>();
            const closes = new EventEmitter<NotebookDocument>();
            disposables.push(changes, closes);
            when(mockedVSCodeNamespaces.workspace.onDidChangeNotebookDocument).thenReturn(changes.event);
            when(mockedVSCodeNamespaces.workspace.onDidCloseNotebookDocument).thenReturn(closes.event);
            new CellOutputDisplayIdTracker(disposables).activate();

            // Pending outputs can only be edited by their submitting execution.
            const pendingOutputs = new Map<
                NotebookCellOutput,
                { cell: NotebookCell; writer: NotebookCellExecution; output: NotebookCellOutput }
            >();
            const sources = new WeakMap<NotebookCellOutput, NotebookCellOutput>();
            const heldAppends = new Map<NotebookCell, (outputs: readonly NotebookCellOutput[]) => Promise<void>>();
            const heldClears = new Map<NotebookCell, () => Promise<void>>();
            const itemEdits: { cell: NotebookCell; output: NotebookCellOutput }[] = [];
            const invalidItemEdits: NotebookCellOutput[] = [];
            const replacements: { cell: NotebookCell; outputs: readonly NotebookCellOutput[] }[] = [];
            let ignoredReplacement: Promise<void> | undefined;
            const createExecution = controller.createNotebookCellExecution.bind(controller);

            function handleOf(output: NotebookCellOutput) {
                return sources.get(output) ?? output;
            }

            // Reconstituted objects retain the host's physical handle, independently of display metadata.
            function copy(output: NotebookCellOutput) {
                const metadata = output.metadata ? JSON.parse(JSON.stringify(output.metadata)) : undefined;
                const wrapper = new NotebookCellOutput(
                    output.items.map((item) => new NotebookCellOutputItem(item.data.slice(), item.mime)),
                    metadata
                );
                sources.set(wrapper, handleOf(output));
                return wrapper;
            }

            function append(cell: NotebookCell, outputs: readonly NotebookCellOutput[]) {
                const visible = outputs.map(copy);
                outputs.forEach((output) => pendingOutputs.delete(handleOf(output)));
                (cell.outputs as NotebookCellOutput[]).push(...visible);
                return visible;
            }

            controller.createNotebookCellExecution = (cell) => {
                const execution = createExecution(cell);
                const clearOutput = execution.clearOutput.bind(execution);
                execution.clearOutput = (target) => {
                    const destination = target || cell;
                    const held = heldClears.get(destination);
                    if (held) {
                        heldClears.delete(destination);
                        return held();
                    }
                    return clearOutput(target);
                };
                execution.appendOutput = (out, target) => {
                    const destination = target || cell;
                    const outputs = out instanceof NotebookCellOutput ? [out] : [...out];
                    const held = heldAppends.get(destination);
                    if (held) {
                        heldAppends.delete(destination);
                        outputs.forEach((output) =>
                            pendingOutputs.set(handleOf(output), { cell: destination, writer: execution, output })
                        );
                        return held(outputs);
                    }
                    append(destination, outputs);
                    return Promise.resolve();
                };
                execution.replaceOutput = (out, target) => {
                    const destination = target || cell;
                    const outputs = out instanceof NotebookCellOutput ? [out] : [...out];
                    replacements.push({ cell: destination, outputs });
                    if (ignoredReplacement) {
                        const result = ignoredReplacement;
                        ignoredReplacement = undefined;
                        return result;
                    }
                    const current = destination.outputs as NotebookCellOutput[];
                    current.splice(0, current.length, ...outputs.map(copy));
                    return Promise.resolve();
                };
                function editItems(
                    items: NotebookCellOutputItem | readonly NotebookCellOutputItem[],
                    output: NotebookCellOutput,
                    appendItems: boolean
                ) {
                    const handle = handleOf(output);
                    const pending = pendingOutputs.get(handle);
                    const submitted =
                        pending &&
                        pending.writer === execution &&
                        pending.cell.notebook === cell.notebook &&
                        !pending.cell.notebook.isClosed &&
                        !pending.cell.document.isClosed &&
                        pending.cell.notebook.getCells().includes(pending.cell)
                            ? pending
                            : undefined;
                    const owner = cell.notebook.isClosed
                        ? undefined
                        : cell.notebook
                              .getCells()
                              .find(
                                  (candidate) =>
                                      !candidate.document.isClosed &&
                                      candidate.outputs.some((current) => handleOf(current) === handle)
                              ) || submitted?.cell;
                    const destination =
                        owner?.outputs.find((current) => handleOf(current) === handle) || submitted?.output;
                    if (!owner || !destination) {
                        invalidItemEdits.push(output);
                        return Promise.reject(new Error('Output is not a host container for this writer'));
                    }
                    itemEdits.push({ cell: owner, output: destination });
                    const newItems = items instanceof NotebookCellOutputItem ? [items] : [...items];
                    destination.items = appendItems ? [...destination.items, ...newItems] : newItems;
                    return Promise.resolve();
                }
                execution.replaceOutputItems = (items, output) => editItems(items, output, false);
                execution.appendOutputItems = (items, output) => editItems(items, output, true);
                return execution;
            };

            function newNotebook(count: number) {
                return createNotebook(
                    Array.from({ length: count }, (_, index) => ({
                        kind: NotebookCellKind.Code,
                        languageId: PYTHON_LANGUAGE,
                        value: `cell ${index}`
                    }))
                );
            }

            function hold() {
                const write = createDeferred<void>();
                return {
                    promise: write.promise,
                    complete() {
                        write.resolve();
                        return write.promise;
                    },
                    reject() {
                        write.reject(new Error('Host rejected edit'));
                        return write.promise.catch(() => undefined);
                    }
                };
            }

            function holdNextAppend(cell: NotebookCell) {
                const write = hold();
                let output: NotebookCellOutput | undefined;
                heldAppends.set(cell, (outputs) => {
                    if (outputs.length !== 1) {
                        throw new Error('Expected one submitted display');
                    }
                    output = outputs[0];
                    return write.promise;
                });
                function submitted() {
                    if (!output) {
                        throw new Error('No append was submitted');
                    }
                    return output;
                }
                return {
                    get submitted() {
                        return submitted();
                    },
                    publish() {
                        return append(cell, [submitted()])[0];
                    },
                    complete: write.complete,
                    async reject() {
                        pendingOutputs.delete(handleOf(submitted()));
                        await write.reject();
                    }
                };
            }

            function holdNextClear(cell: NotebookCell, onSubmit?: (apply: () => void) => void) {
                const write = hold();
                let submitted = false;
                function apply() {
                    if (!submitted) {
                        throw new Error('No clear was submitted');
                    }
                    (cell.outputs as NotebookCellOutput[]).splice(0, cell.outputs.length);
                }
                heldClears.set(cell, () => {
                    submitted = true;
                    onSubmit?.(apply);
                    return write.promise;
                });
                return {
                    get submitted() {
                        return submitted;
                    },
                    promise: write.promise,
                    apply,
                    complete: write.complete,
                    reject: write.reject
                };
            }

            function holdNextReplacement() {
                const write = hold();
                ignoredReplacement = write.promise;
                return write;
            }

            function notify(cell: NotebookCell, kind: 'snapshot' | 'empty' | 'unrelated' = 'snapshot') {
                const outputs = kind === 'snapshot' ? cell.outputs.map(copy) : kind === 'empty' ? [] : undefined;
                changes.fire({
                    notebook: cell.notebook,
                    metadata: undefined,
                    contentChanges: [],
                    cellChanges: [
                        { cell, outputs, document: undefined, metadata: undefined, executionSummary: undefined }
                    ]
                });
                return outputs;
            }

            function publish(cell: NotebookCell, write: ReturnType<typeof holdNextAppend>) {
                const visible = write.publish();
                const reported = notify(cell);
                if (!reported) {
                    throw new Error('Expected an output snapshot');
                }
                return { visible, reported };
            }

            function removeCell(cell: NotebookCell) {
                const cells = cell.notebook.getCells();
                const index = cells.indexOf(cell);
                if (index < 0) {
                    throw new Error('Cell is already removed');
                }
                cells.splice(index, 1);
                changes.fire({
                    notebook: cell.notebook,
                    metadata: undefined,
                    contentChanges: [
                        { range: new NotebookRange(index, index + 1), addedCells: [], removedCells: [cell] }
                    ],
                    cellChanges: []
                });
            }

            function close(notebook: NotebookDocument) {
                Object.defineProperty(notebook, 'isClosed', { value: true, configurable: true });
                closes.fire(notebook);
            }

            const notebook = newNotebook(cellCount);
            return {
                notebook,
                newNotebook,
                handleOf,
                holdNextAppend,
                holdNextClear,
                holdNextReplacement,
                notify,
                publish,
                removeCell,
                close,
                itemEdits,
                invalidItemEdits,
                replacements
            };
        }

        async function pendingClear(host: ReturnType<typeof createDisplayTestHost>, cell: NotebookCell, text: string) {
            const append = host.holdNextAppend(cell);
            const clear = host.holdNextClear(cell);
            await runMessages(cell, (producer) => [producer.displayOutput(display(text)), clearOutput(producer)]);
            return { append, clear };
        }

        test('An ordered clear retires an unreported append and its deferred update', async () => {
            const host = createDisplayTestHost(3);
            const [owner, updater, verifier] = host.notebook.getCells();
            const { append, clear } = await pendingClear(host, owner, 'old');
            assert.isTrue(clear.submitted);
            const old = mapped(owner);
            assert.strictEqual(old?.outputContainer, append.submitted);

            await runUpdates(updater, ['stale'], 2);
            assert.isEmpty(host.itemEdits);
            append.publish();
            clear.apply();
            await clear.complete();

            assert.isEmpty(owner.outputs);
            assert.isUndefined(mapped(owner));
            host.notify(owner);
            await append.complete();
            await runUpdates(verifier, ['must not return'], 3);
            assert.isEmpty(owner.outputs);
            assert.isEmpty(verifier.outputs);
            assert.isEmpty(host.itemEdits);
            assert.isEmpty(host.invalidItemEdits);
            assert.isEmpty(host.replacements);
        });

        test('A delayed clear and old append completion preserve a later same-writer registration', async () => {
            const host = createDisplayTestHost(2);
            const [owner, updater] = host.notebook.getCells();
            const oldAppend = host.holdNextAppend(owner);
            const state: { next?: ReturnType<typeof host.holdNextAppend> } = {};
            const clear = host.holdNextClear(owner, (apply) => {
                oldAppend.publish();
                apply();
                state.next = host.holdNextAppend(owner);
            });
            await runMessages(owner, (producer) => [
                producer.displayOutput(display('old')),
                clearOutput(producer),
                producer.displayOutput(display('new'))
            ]);
            const { next } = state;
            if (!next) {
                throw new Error('Expected both ordered append submissions');
            }
            const current = mapped(owner);
            assert.strictEqual(current?.cell, owner);
            assert.notStrictEqual(trackingId(next.submitted), trackingId(oldAppend.submitted));
            assert.isEmpty(owner.outputs);

            await clear.complete();
            assert.strictEqual(mapped(owner), current);
            await oldAppend.complete();
            assert.strictEqual(mapped(owner), current);

            host.publish(owner, next);
            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['new']);
            await runUpdates(updater, ['updated'], 2);
            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['updated']);
            assert.strictEqual(mapped(owner), current);
            assert.lengthOf(host.itemEdits, 1);
            assert.isEmpty(host.invalidItemEdits);
            (owner.outputs as NotebookCellOutput[]).splice(0, owner.outputs.length);
            host.notify(owner);
            assert.isUndefined(mapped(owner));
            await next.complete();
            await runUpdates(updater, ['after removal'], 3);
            assert.isUndefined(mapped(owner));
            assert.isEmpty(owner.outputs);
            assert.lengthOf(host.itemEdits, 1);
        });

        test('A clear completion leaves a now-visible output to the removal event', async () => {
            const host = createDisplayTestHost(2);
            const [owner, updater] = host.notebook.getCells();
            const { append, clear } = await pendingClear(host, owner, 'visible');
            const tracked = mapped(owner);
            append.publish();
            await clear.complete();
            assert.strictEqual(mapped(owner), tracked);
            await runUpdates(updater, ['updated'], 2);
            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['updated']);

            clear.apply();
            host.notify(owner);
            assert.isUndefined(mapped(owner));
            await append.complete();
            assert.isEmpty(owner.outputs);
        });

        test('A rejected clear preserves the pending route and its deferred update', async () => {
            const host = createDisplayTestHost(2);
            const [owner, updater] = host.notebook.getCells();
            const { append, clear } = await pendingClear(host, owner, 'old');
            const tracked = mapped(owner);
            await runUpdates(updater, ['updated'], 2);
            assert.isEmpty(host.itemEdits);
            await clear.reject();
            assert.strictEqual(mapped(owner), tracked);

            host.publish(owner, append);
            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['updated']);
            assert.lengthOf(host.itemEdits, 1);
            assert.isEmpty(host.invalidItemEdits);
            await append.complete();
        });

        test('Clear retirement is scoped to the submitting writer and explicit destination', async () => {
            const host = createDisplayTestHost(3);
            const [source, target, updater] = host.notebook.getCells();
            const writer = createTestExecution(source);
            function submit(cell: NotebookCell, id: string, text: string) {
                const output = new NotebookCellOutput([NotebookCellOutputItem.text(text)], {
                    outputType: 'display_data',
                    metadata: {},
                    transient: { display_id: id }
                });
                const route = CellOutputDisplayIdTracker.trackOutputByDisplayId(cell, id, output, writer);
                const write = writer.appendOutput(output, cell === source ? undefined : cell);
                return { route, write };
            }
            const appendSource = host.holdNextAppend(source);
            const { route: sourceRoute, write: sourceWrite } = submit(source, display_id, 'source');
            const appendTarget = host.holdNextAppend(target);
            const { route: targetRoute, write: targetWrite } = submit(target, display_id2, 'target');

            const otherWriter = createTestExecution(source);
            await otherWriter.clearOutput();
            assert.strictEqual(mapped(source), sourceRoute);
            assert.strictEqual(mapped(target, display_id2), targetRoute);

            const clear = host.holdNextClear(target);
            const clearResult = writer.clearOutput(target);
            assert.strictEqual(clearResult, clear.promise);
            appendTarget.publish();
            clear.apply();
            await clear.complete();
            await clearResult;
            assert.isUndefined(mapped(target, display_id2));
            assert.strictEqual(mapped(source), sourceRoute);
            await appendTarget.complete();
            await targetWrite;

            host.publish(source, appendSource);
            await runUpdates(updater, ['source updated'], 2);
            assert.deepEqual(source.outputs.map(getTextOutputValue), ['source updated']);
            assert.isEmpty(target.outputs);
            assert.isEmpty(host.invalidItemEdits);
            await appendSource.complete();
            await sourceWrite;
        });

        test('A wait clear only arms a flag and does not consume display updates', async () => {
            const host = createDisplayTestHost(2);
            const [owner, updater] = host.notebook.getCells();
            await runMessages(owner, (producer) => [producer.displayOutput(display('visible'))]);
            const append = host.holdNextAppend(owner);
            const clear = host.holdNextClear(owner);
            await runMessages(
                owner,
                (producer) => [
                    producer.displayOutput(display('pending', display_id2)),
                    producer.displayUpdate(display('same writer', display_id2)),
                    clearOutput(producer, true),
                    producer.displayUpdate(display('visible updated'))
                ],
                2
            );
            assert.isFalse(clear.submitted);
            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['visible updated']);
            assert.strictEqual(mapped(owner, display_id2)?.cell, owner);
            assert.strictEqual(getTextOutputValue(append.submitted), 'same writer');
            assert.lengthOf(host.itemEdits, 2);
            assert.strictEqual(host.itemEdits[0].output, append.submitted);
            await runUpdates(updater, [display('pending updated', display_id2)], 3);
            assert.lengthOf(host.itemEdits, 2);
            const { visible } = host.publish(owner, append);
            assert.notStrictEqual(visible, append.submitted);
            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['visible updated', 'pending updated']);
            assert.lengthOf(host.itemEdits, 3);
            assert.isFalse(clear.submitted);
            assert.isEmpty(host.invalidItemEdits);
            assert.isEmpty(host.replacements);
            await append.complete();
        });

        test('A rejected unpublished item update can be retried without an older rejection undoing it', async () => {
            const host = createDisplayTestHost(1);
            const [owner] = host.notebook.getCells();
            const append = host.holdNextAppend(owner);
            const editor = controller.createNotebookCellExecution(owner);
            const replaceItems = editor.replaceOutputItems.bind(editor);
            const older = createDeferred<void>();
            const latest = createDeferred<void>();
            let attempts = 0;
            editor.replaceOutputItems = (items, output) => {
                attempts += 1;
                return attempts === 1 ? older.promise : attempts === 2 ? latest.promise : replaceItems(items, output);
            };
            const execution = new NotebookCellExecutionWrapper(editor, controller.id, () => undefined);
            const { request, producer, handler } = sendRequest(owner, 'display', execution);

            async function send(message: KernelMessage.IIOPubMessage) {
                const processed = createDeferred<void>();
                const onMessage = (_: unknown, received: KernelMessage.IIOPubMessage) => {
                    if (received.header.msg_id === message.header.msg_id) {
                        kernel.iopubMessage.disconnect(onMessage);
                        processed.resolve();
                    }
                };
                kernel.iopubMessage.connect(onMessage);
                fakeSocket.emitOnMessage(message);
                await processed.promise;
            }

            await send(producer.status('busy'));
            await send(producer.displayOutput(display('initial')));
            await send(producer.displayUpdate(display('older')));
            await send(producer.displayUpdate(display('updated')));
            assert.strictEqual(attempts, 2);
            assert.isEmpty(owner.outputs);

            latest.reject(new Error('Host rejected item edit'));
            await latest.promise.catch(() => undefined);
            await send(producer.displayUpdate(display('updated')));
            older.reject(new Error('Host rejected older item edit'));
            await older.promise.catch(() => undefined);
            await send(producer.displayUpdate(display('updated')));

            host.publish(owner, append);
            await append.complete();
            fakeSocket.emitOnMessage(producer.status('idle'));
            fakeSocket.emitOnMessage(producer.reply(1));
            await request.done;
            await handler.completed;
            execution.end(true);

            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['updated']);
            assert.lengthOf(host.itemEdits, 1);
            assert.strictEqual(host.itemEdits[0].output, append.submitted);
            assert.isEmpty(host.invalidItemEdits);
            assert.isEmpty(host.replacements);
            assert.isUndefined(messageHandlingFailure);
        });

        test('Execution-start clear uses the wrapper once without delaying later output', async () => {
            const host = createDisplayTestHost(1);
            const [cell] = host.notebook.getCells();
            const clear = host.holdNextClear(cell, (apply) => apply());
            const implementation = controller.createNotebookCellExecution(cell);
            const start = implementation.start.bind(implementation);
            let starts = 0;
            implementation.start = (time) => {
                starts += 1;
                start(time);
            };
            const execution = new NotebookCellExecutionWrapper(implementation, controller.id, () => undefined, true);
            const clearOutput = execution.clearOutput.bind(execution);
            let clears = 0;
            execution.clearOutput = (target) => {
                clears += 1;
                return clearOutput(target);
            };

            execution.start(123);
            execution.start(456);
            assert.strictEqual(starts, 1);
            assert.strictEqual(clears, 1);
            assert.isTrue(clear.submitted);
            await execution.appendOutput(new NotebookCellOutput([NotebookCellOutputItem.text('new')]));
            assert.deepEqual(cell.outputs.map(getTextOutputValue), ['new']);
            await clear.complete();
            assert.deepEqual(cell.outputs.map(getTextOutputValue), ['new']);
        });

        const latestMetadata = { 'text/plain': { phase: 'latest' } };
        for (const scenario of [
            { name: 'latest update', updates: ['B', 'A', 'Latest'], expected: 'Latest', edits: 1, metadata: undefined },
            { name: 'reversion', updates: ['B', 'A'], expected: 'A', edits: 0, metadata: undefined },
            {
                name: 'metadata update',
                updates: [{ ...display('latest'), metadata: latestMetadata }],
                expected: 'latest',
                edits: 0,
                metadata: latestMetadata
            }
        ]) {
            test(`An unpublished display retains the ${scenario.name} across execution end`, async () => {
                const host = createDisplayTestHost(2);
                const [owner, updater] = host.notebook.getCells();
                const pending = host.holdNextAppend(owner);

                await show(owner, 'A');
                assert.isTrue(owner.executionSummary?.success);
                const token = trackingId(pending.submitted);
                assert.isString(token);
                assert.isEmpty(owner.outputs);
                host.notify(owner, 'empty');
                assert.strictEqual(mapped(owner)?.cell, owner);

                await runUpdates(updater, scenario.updates, 2);
                const previousSummary = updater.executionSummary;
                assert.isEmpty(host.itemEdits);
                assert.isEmpty(host.replacements);
                assert.isEmpty(owner.outputs);

                const { visible, reported } = host.publish(owner, pending);
                assert.notStrictEqual(visible, pending.submitted);
                assert.notStrictEqual(reported[0], visible);
                assert.strictEqual(host.handleOf(visible), host.handleOf(pending.submitted));
                assert.strictEqual(host.handleOf(reported[0]), host.handleOf(visible));
                assert.strictEqual(trackingId(visible), token);
                assert.strictEqual(trackingId(reported[0]), token);
                assert.strictEqual(trackingId(owner.outputs[0]), token);
                assert.strictEqual(getTextOutputValue(owner.outputs[0]), scenario.expected);
                assert.lengthOf(host.itemEdits, scenario.edits);
                assert.lengthOf(host.replacements, scenario.metadata ? 1 : 0);
                if (scenario.metadata) {
                    assert.strictEqual(host.replacements[0].cell, owner);
                    assert.deepEqual(owner.outputs[0].metadata?.metadata, scenario.metadata);
                }
                assert.isEmpty(updater.outputs);
                host.notify(owner);
                await pending.complete();

                assert.strictEqual(getTextOutputValue(owner.outputs[0]), scenario.expected);
                assert.lengthOf(host.itemEdits, scenario.edits);
                if (scenario.edits) {
                    assert.strictEqual(host.itemEdits[0].cell, owner);
                }
                assert.isEmpty(host.invalidItemEdits);
                assert.lengthOf(host.replacements, scenario.metadata ? 1 : 0);
                assert.strictEqual(updater.executionSummary?.executionOrder, previousSummary?.executionOrder);
                assert.strictEqual(updater.executionSummary?.success, previousSummary?.success);
                assert.strictEqual(mapped(owner)?.cell, owner);
            });
        }

        test('An observed removal retires its display without clearing a newer owner', async () => {
            const host = createDisplayTestHost();
            const [owner, replacement, updater] = host.notebook.getCells();
            await runMessages(owner, (producer) => [
                producer.displayOutput(display('old')),
                producer.stream({ name: 'stdout', text: 'sibling\n' })
            ]);
            const oldToken = trackingId(owner.outputs[0]);
            host.notify(owner, 'unrelated');
            assert.strictEqual(mapped(owner)?.cell, owner);

            (owner.outputs as NotebookCellOutput[]).splice(0, 1);
            host.notify(owner);
            assert.lengthOf(owner.outputs, 1);
            assert.isUndefined(mapped(owner));

            await runMessages(replacement, (producer) => [producer.displayOutput(display('new owner'))], 2);
            const newToken = trackingId(replacement.outputs[0]);
            assert.notStrictEqual(newToken, oldToken);
            await runMessages(owner, (producer) => [clearOutput(producer)], 3);
            host.notify(owner);
            assert.strictEqual(mapped(owner)?.cell, replacement);

            await runUpdates(updater, ['updated'], 4);
            assert.isEmpty(owner.outputs);
            assert.deepEqual(replacement.outputs.map(getTextOutputValue), ['updated']);
            assert.strictEqual(trackingId(replacement.outputs[0]), newToken);
            assert.strictEqual(host.itemEdits[0].cell, replacement);
        });

        for (const scenario of ['rejected', 'rejected after replacement', 'cell removal', 'notebook close'] as const) {
            test(`${scenario} detaches a pending display without damaging a replacement`, async () => {
                const host = createDisplayTestHost(4);
                const [owner, updater, candidate, candidateUpdater] = host.notebook.getCells();
                const pending = host.holdNextAppend(owner);
                await show(owner, 'old');
                await runUpdates(updater, ['stale update'], 2);
                assert.isEmpty(host.itemEdits);

                const replacementFirst = scenario === 'rejected after replacement';
                if (replacementFirst) {
                    await show(candidate, 'replacement', 3);
                }
                if (scenario.startsWith('rejected')) {
                    await pending.reject();
                } else if (scenario === 'cell removal') {
                    host.removeCell(owner);
                    assert.notInclude(host.notebook.getCells(), owner);
                } else {
                    host.close(host.notebook);
                }
                if (replacementFirst) {
                    assert.strictEqual(mapped(owner)?.cell, candidate);
                } else {
                    assert.isUndefined(mapped(owner));
                }

                const [replacement, verifier] =
                    scenario === 'notebook close' ? host.newNotebook(2).getCells() : [candidate, candidateUpdater];
                if (!replacementFirst) {
                    await show(replacement, 'replacement', 3);
                }
                const newToken = trackingId(replacement.outputs[0]);
                assert.notStrictEqual(newToken, trackingId(pending.submitted));

                host.publish(owner, pending);
                if (!scenario.startsWith('rejected')) {
                    await pending.complete();
                }
                assert.deepEqual(owner.outputs.map(getTextOutputValue), ['old']);
                assert.strictEqual(mapped(replacement)?.cell, replacement);
                assert.deepEqual(replacement.outputs.map(getTextOutputValue), ['replacement']);
                assert.isEmpty(host.itemEdits);

                await runUpdates(verifier, ['fresh update'], 4);
                assert.deepEqual(replacement.outputs.map(getTextOutputValue), ['fresh update']);
                assert.strictEqual(trackingId(replacement.outputs[0]), newToken);
                assert.isEmpty(host.invalidItemEdits);
            });
        }

        test('Widget clear and capture preserve unrelated routes and redirect vendor output', async () => {
            const host = createDisplayTestHost();
            const [owner, updater, verifier] = host.notebook.getCells();
            const commId = 'output-widget';
            const vendorMime = 'application/vnd.example.widget-output+json';
            const vendorId = 'widget-vendor-id';
            kernel.registerCommTarget(Identifiers.DefaultCommTarget, () => undefined);
            when(mockedVSCodeNamespaces.extensions.getExtension(RendererExtension)).thenReturn(undefined);

            await runMessages(owner, (producer) => [
                widgetOpen(producer, commId),
                producer.displayOutput({
                    data: { [WIDGET_MIMETYPE]: { model_id: commId, version_major: 2, version_minor: 0 } },
                    metadata: {}
                }),
                producer.displayOutput(display('ordinary'))
            ]);
            const originalToken = trackingId(owner.outputs[1]);
            const append = host.holdNextAppend(owner);
            const clear = host.holdNextClear(owner);
            await runMessages(
                owner,
                (producer) => [
                    producer.displayOutput(display('pending', display_id2)),
                    widgetCapture(producer, commId),
                    clearOutput(producer)
                ],
                2
            );
            assert.isFalse(clear.submitted);
            assert.lengthOf(host.replacements, 1);
            const tracked = mapped(owner, display_id2);
            assert.strictEqual(tracked?.cell, owner);
            await runUpdates(updater, [display('pending updated', display_id2)], 3);
            host.publish(owner, append);
            assert.deepEqual(owner.outputs.slice(1).map(getTextOutputValue), ['ordinary', 'pending updated']);
            assert.strictEqual(mapped(owner, display_id2), tracked);
            await append.complete();

            await runMessages(
                updater,
                (producer) => [
                    widgetCapture(producer, commId),
                    producer.displayOutput(display('swallowed')),
                    producer.displayOutput({
                        data: { [vendorMime]: { value: 'vendor' }, 'text/plain': 'vendor' },
                        metadata: {},
                        transient: { display_id: vendorId }
                    })
                ],
                4
            );

            assert.isEmpty(updater.outputs);
            assert.lengthOf(owner.outputs, 4);
            assert.deepEqual(owner.outputs.slice(1).map(getTextOutputValue), ['vendor', 'ordinary', 'pending updated']);
            assert.strictEqual(trackingId(owner.outputs[2]), originalToken);
            assert.strictEqual(mapped(owner)?.cell, owner);
            assert.strictEqual(mapped(owner, display_id2)?.cell, owner);
            assert.strictEqual(mapped(owner, vendorId)?.cell, owner);
            assert.lengthOf(host.replacements, 2);
            assert.strictEqual(host.replacements[1].cell, owner);

            await runUpdates(
                verifier,
                [
                    'ordinary updated',
                    {
                        data: { [vendorMime]: { value: 'updated' }, 'text/plain': 'vendor updated' },
                        metadata: {},
                        transient: { display_id: vendorId }
                    }
                ],
                5
            );
            assert.deepEqual(owner.outputs.slice(1).map(getTextOutputValue), [
                'vendor updated',
                'ordinary updated',
                'pending updated'
            ]);
            assert.isEmpty(updater.outputs);
            assert.isEmpty(verifier.outputs);
            assert.lengthOf(host.itemEdits, 3);
            host.itemEdits.forEach((edit) => assert.strictEqual(edit.cell, owner));
            assert.isEmpty(host.invalidItemEdits);
        });

        for (const outcome of ['ignored', 'rejected'] as const) {
            test(`Metadata replacement ${outcome} preserves the installed output and siblings`, async () => {
                const host = createDisplayTestHost(2);
                const [owner, updater] = host.notebook.getCells();
                const initialData = { 'text/plain': 'one', 'text/html': '<b>one</b>' };
                const changedData = { 'text/plain': 'changed', 'text/html': '<b>changed</b>' };
                const preflightData = { 'text/plain': 'preflight', 'text/html': '<b>preflight</b>' };
                const initialMetadata = { 'text/plain': { phase: 'before' } };
                const changedMetadata = { 'text/plain': { phase: 'after' } };
                const update = (data: typeof initialData, metadata: typeof initialMetadata) => ({
                    data,
                    metadata,
                    transient: { display_id }
                });
                await runMessages(owner, (producer) => [
                    producer.displayOutput(update(initialData, initialMetadata)),
                    producer.displayOutput(display('sibling', display_id2)),
                    producer.stream({ name: 'stdout', text: 'unrelated\n' })
                ]);
                const installed = owner.outputs[0];
                const targetToken = trackingId(installed);
                assert.isString(targetToken);
                assert.isNotEmpty(targetToken as string);
                const siblingToken = trackingId(owner.outputs[1]);
                installed.metadata = {
                    ...installed.metadata,
                    _vscode: { ...installed.metadata?._vscode, retained: 'yes' },
                    external: 'preserved'
                };
                host.notify(owner);

                await runUpdates(updater, [update(preflightData, initialMetadata)], 2);
                assert.deepEqual(owner.outputs.map(getTextOutputValue), ['preflight', 'sibling', 'unrelated\n']);
                assert.strictEqual(trackingId(owner.outputs[0]), targetToken);
                assert.lengthOf(host.itemEdits, 1);
                assert.strictEqual(host.itemEdits[0].output, installed);
                assert.isEmpty(host.replacements);

                const replacement = host.holdNextReplacement();
                await runUpdates(updater, [update(preflightData, changedMetadata)], 3);
                await (outcome === 'rejected' ? replacement.reject() : replacement.complete());
                assert.lengthOf(host.replacements, 1);
                assert.strictEqual(host.replacements[0].cell, owner);
                assert.notStrictEqual(host.replacements[0].outputs[0], installed);
                assert.notStrictEqual(host.handleOf(host.replacements[0].outputs[0]), host.handleOf(installed));
                assert.strictEqual(trackingId(host.replacements[0].outputs[0]), targetToken);
                assert.strictEqual(owner.outputs[0], installed);
                assert.deepEqual(installed.metadata?.metadata, initialMetadata);
                assert.lengthOf(host.itemEdits, 1);

                await runUpdates(updater, [update(changedData, initialMetadata)], 4);
                assert.deepEqual(owner.outputs.map(getTextOutputValue), ['changed', 'sibling', 'unrelated\n']);
                assert.lengthOf(host.replacements, 1);
                assert.lengthOf(host.itemEdits, 2);
                assert.strictEqual(host.itemEdits[1].output, installed);
                assert.strictEqual(trackingId(owner.outputs[0]), targetToken);
                assert.isEmpty(host.invalidItemEdits);

                await runUpdates(updater, [update(changedData, changedMetadata)], 5);
                assert.lengthOf(host.replacements, 2);
                assert.deepEqual(owner.outputs.map(getTextOutputValue), ['changed', 'sibling', 'unrelated\n']);
                assert.deepEqual(owner.outputs[0].metadata?.metadata, changedMetadata);
                assert.strictEqual(owner.outputs[0].metadata?._vscode.retained, 'yes');
                assert.strictEqual(owner.outputs[0].metadata?.external, 'preserved');
                assert.strictEqual(trackingId(owner.outputs[0]), targetToken);
                assert.strictEqual(trackingId(owner.outputs[1]), siblingToken);
                assert.isUndefined(trackingId(owner.outputs[2]));

                const rebound = owner.outputs[0];
                assert.notStrictEqual(rebound, installed);
                assert.notStrictEqual(host.handleOf(rebound), host.handleOf(installed));
                await runUpdates(
                    updater,
                    [update({ 'text/plain': 'final', 'text/html': '<b>final</b>' }, changedMetadata)],
                    6
                );
                assert.deepEqual(owner.outputs.map(getTextOutputValue), ['final', 'sibling', 'unrelated\n']);
                assert.lengthOf(host.itemEdits, 3);
                assert.strictEqual(host.itemEdits[2].output, rebound);
                assert.lengthOf(host.replacements, 2);
                assert.isEmpty(host.invalidItemEdits);

                const rerun = createTestExecution(owner, true);
                await executeCellWithOutput(owner, 'display', 7, (p) => [p.displayOutput(display('one'))], rerun);
                assert.lengthOf(owner.outputs, 1);
                const nextToken = trackingId(owner.outputs[0]);
                assert.isString(nextToken);
                assert.notStrictEqual(nextToken, targetToken);
            });
        }

        test('An in-flight metadata reversion survives older write failures', async () => {
            const host = createDisplayTestHost(2);
            const [owner, updater] = host.notebook.getCells();
            const metadata = (width: number) => ({ 'text/plain': { width } });
            const update = (width: number, text = 'initial') => ({
                data: { 'text/plain': text },
                metadata: metadata(width),
                transient: { display_id }
            });
            await runMessages(owner, (producer) => [
                producer.displayOutput(update(1)),
                producer.displayOutput(display('sibling', display_id2))
            ]);
            const [installed, sibling] = owner.outputs;
            const token = trackingId(installed);

            const writes: ReturnType<typeof host.holdNextReplacement>[] = [];
            for (const width of [2, 1, 2]) {
                writes.push(host.holdNextReplacement());
                await runUpdates(updater, [update(width)], writes.length + 1);
                assert.lengthOf(host.replacements, writes.length);
            }
            const [first, revert, newer] = writes;
            await first.reject();
            assert.strictEqual(mapped(owner)?.cell, owner);
            assert.strictEqual(owner.outputs[0], installed);

            const latest = host.holdNextReplacement();
            await runUpdates(updater, [update(1)], 5);
            assert.lengthOf(host.replacements, 4);
            await latest.reject();
            assert.strictEqual(mapped(owner)?.cell, owner);
            assert.strictEqual(owner.outputs[0], installed);
            assert.deepEqual(installed.metadata?.metadata, metadata(1));

            await runUpdates(updater, [update(1, 'changed')], 6);
            assert.lengthOf(host.replacements, 4);
            assert.lengthOf(host.itemEdits, 1);
            assert.strictEqual(host.itemEdits[0].output, installed);
            assert.strictEqual(owner.outputs[1], sibling);
            assert.strictEqual(trackingId(owner.outputs[0]), token);
            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['changed', 'sibling']);
            assert.isEmpty(host.invalidItemEdits);

            await Promise.all([revert.complete(), newer.complete()]);
            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['changed', 'sibling']);
            assert.strictEqual(mapped(owner)?.cell, owner);
        });

        test('A tagged execute result updates without adopting untagged results or unrelated output', async () => {
            const host = createDisplayTestHost(2);
            const [owner, updater] = host.notebook.getCells();
            await runMessages(owner, (producer) => [
                executeResult(producer, 'tagged', display_id),
                executeResult(producer, 'ordinary'),
                producer.stream({ name: 'stdout', text: 'unrelated\n' })
            ]);
            const token = trackingId(owner.outputs[0]);
            assert.isString(token);
            assert.isUndefined(trackingId(owner.outputs[1]));
            assert.isUndefined(trackingId(owner.outputs[2]));
            assert.strictEqual(mapped(owner)?.cell, owner);

            await runUpdates(updater, ['updated'], 2);
            assert.deepEqual(owner.outputs.map(getTextOutputValue), ['updated', 'ordinary', 'unrelated\n']);
            assert.strictEqual(translateCellDisplayOutput(owner.outputs[0]).output_type, 'execute_result');
            assert.strictEqual(trackingId(owner.outputs[0]), token);
            assert.lengthOf(host.itemEdits, 1);
            assert.isEmpty(host.replacements);
            assert.isEmpty(host.invalidItemEdits);
        });

        test('Update a display after the previous clear is reported during append (#17554)', async () => {
            const changes = new EventEmitter<NotebookDocumentChangeEvent>();
            disposables.push(changes);
            when(mockedVSCodeNamespaces.workspace.onDidChangeNotebookDocument).thenReturn(changes.event);
            new CellOutputDisplayIdTracker(disposables).activate();

            const displayCode = "did = display('Before update.', display_id=True)";
            const updateCode = "did.update('Updated')";
            const notebook = createNotebook(
                [displayCode, updateCode].map((value) => ({
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value
                }))
            );
            const [cell, updateCell] = notebook.getCells();
            const notifyOutputs = () =>
                changes.fire({
                    notebook,
                    metadata: undefined,
                    contentChanges: [],
                    cellChanges: [
                        {
                            cell,
                            outputs: [...cell.outputs],
                            document: undefined,
                            metadata: undefined,
                            executionSummary: undefined
                        }
                    ]
                });

            const host = controller.createNotebookCellExecution(cell);
            await host.appendOutput(new NotebookCellOutput([NotebookCellOutputItem.text('Previous run')]));
            const appendOutput = host.appendOutput.bind(host);
            host.appendOutput = async (out) => {
                // VS Code reports the execution-start clear while the new display is still waiting to be appended.
                notifyOutputs();
                await appendOutput(out);
                notifyOutputs();
            };
            const execution = new NotebookCellExecutionWrapper(host, controller.id, undefined, true);
            const display = { data: { 'text/plain': 'Before update.' }, metadata: {}, transient: { display_id } };
            await executeCellWithOutput(cell, displayCode, 1, (p) => [p.displayOutput(display)], execution);
            assert.deepEqual(cell.outputs.map(getTextOutputValue), ['Before update.']);

            await executeCellWithOutput(updateCell, updateCode, 2, (p) => [
                p.displayUpdate({ ...display, data: { 'text/plain': 'Updated' } })
            ]);
            assert.strictEqual(getTextOutputValue(cell.outputs[0]), 'Updated');
        });
        test('Execute cell and add output (Issue 8621)', async () => {
            const notebook = createNotebook([
                { kind: NotebookCellKind.Code, languageId: PYTHON_LANGUAGE, value: imageCell, outputs: [] },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: 'h.update(Image(img, width=500, height=500))',
                    outputs: []
                }
            ]);
            const cell = notebook.cellAt(0);

            await executeCellWithOutput(cell, imageCell, 1, (producer) => {
                return [
                    producer.displayOutput({
                        data: imageOutput.data,
                        metadata: imageOutput.metadata,
                        transient: { display_id: 'displayIdXYZ' }
                    })
                ];
            });
            assert.strictEqual(cell.outputs.length, 1);
            const output = translateCellDisplayOutput(cell.outputs[0]);
            delete output.transient;
            assert.deepEqual(output, imageOutput);
        });
        test('Execute cell and update Display Data with metadata (Issue 8621)', async () => {
            const notebook = createNotebook([
                { kind: NotebookCellKind.Code, languageId: PYTHON_LANGUAGE, value: imageCell, outputs: [] },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: 'h.update(Image(img, width=500, height=500))',
                    outputs: []
                }
            ]);
            const cell = notebook.cellAt(0);

            await executeCellWithOutput(cell, imageCell, 1, (producer) => {
                return [
                    producer.displayOutput({
                        data: imageOutput.data,
                        metadata: imageOutput.metadata,
                        transient: { display_id: 'displayIdXYZ' }
                    })
                ];
            });
            assert.strictEqual(cell.outputs.length, 1);
            const output = translateCellDisplayOutput(cell.outputs[0]);
            delete output.transient;
            assert.deepEqual(output, imageOutput);

            // Now update the display data of the first cell from the second cell
            await executeCellWithOutput(
                notebook.cellAt(1),
                'h.update(Image(img, width=500, height=500))',
                2,
                (producer) => {
                    return [
                        producer.displayUpdate({
                            data: imageUpdateOutput.data,
                            metadata: imageUpdateOutput.metadata,
                            transient: { display_id: 'displayIdXYZ' }
                        })
                    ];
                }
            );
            assert.strictEqual(cell.outputs.length, 1);
            const output2 = translateCellDisplayOutput(cell.outputs[0]);
            delete output2.transient;
            assert.deepEqual(
                output2,
                Object.assign({}, imageOutput, {
                    metadata: {
                        'image/png': {
                            height: 500,
                            width: 500
                        }
                    }
                })
            );
        });
        test('Execute cell and update Display Data with metadata (even if Cell DOM has not yet been updated) (Issue 8621)', async () => {
            const notebook = createNotebook([
                { kind: NotebookCellKind.Code, languageId: PYTHON_LANGUAGE, value: imageCell, outputs: [] },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: 'h.update(Image(img, width=500, height=500))',
                    outputs: []
                }
            ]);
            const cell = notebook.cellAt(0);
            await executeCellWithOutput(cell, imageCell, 1, (producer) => {
                return [
                    producer.displayOutput({
                        data: imageOutput.data,
                        metadata: imageOutput.metadata,
                        transient: { display_id: 'displayIdXYZ' }
                    })
                ];
            });
            assert.strictEqual(cell.outputs.length, 1);
            const output = translateCellDisplayOutput(cell.outputs[0]);
            delete output.transient;
            assert.deepEqual(output, imageOutput);

            // Mimic a situation where the cell outputs have not yet been updated in the DOM.
            notebook.cellAt(0).outputs.slice(0, notebook.cellAt(0).outputs.length);

            // Now update the display data of the first cell from the second cell
            await executeCellWithOutput(
                notebook.cellAt(1),
                'h.update(Image(img, width=500, height=500))',
                2,
                (producer) => {
                    return [
                        producer.displayUpdate({
                            data: imageUpdateOutput.data,
                            metadata: imageUpdateOutput.metadata,
                            transient: { display_id: 'displayIdXYZ' }
                        })
                    ];
                }
            );
            assert.strictEqual(cell.outputs.length, 1);
            const output2 = translateCellDisplayOutput(cell.outputs[0]);
            delete output2.transient;
            assert.deepEqual(
                output2,
                Object.assign({}, imageOutput, {
                    metadata: {
                        'image/png': {
                            height: 500,
                            width: 500
                        }
                    }
                })
            );
        });
        test('Execute cell and add Display output', async () => {
            const notebook = createNotebook([
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                }
            ]);
            const cell = notebook.cellAt(0);
            await executeCellWithOutput(cell, addDisplayDataOutput, 1, (producer) => {
                return [
                    producer.displayOutput({
                        data: imageOutput.data,
                        metadata: imageOutput.metadata,
                        transient: { display_id }
                    })
                ];
            });

            assert.isAtLeast(cell.outputs.length, 1);
            const output = translateCellDisplayOutput(cell.outputs[0]);
            assert.strictEqual((output.transient as any).display_id, display_id);

            // Update the display data.
            await executeCellWithOutput(notebook.cellAt(1), codeToUpdateDisplayDataHello, 1, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromHelloUpdate.data,
                        metadata: outputsFromHelloUpdate.metadata,
                        transient: { display_id }
                    })
                ];
            });
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'Hello'
            );
            // Update the display data again.
            await executeCellWithOutput(notebook.cellAt(1), codeToUpdateDisplayDataWorld, 1, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromWorldUpdate.data,
                        metadata: outputsFromWorldUpdate.metadata,
                        transient: { display_id }
                    })
                ];
            });
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'World'
            );
        });

        test('Execute cell and add Display output (even if Cell DOM has not yet been updated) ', async () => {
            const notebook = createNotebook([
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                }
            ]);
            const cell = notebook.cellAt(0);

            await executeCellWithOutput(cell, addDisplayDataOutput, 1, (producer) => {
                return [
                    producer.displayOutput({
                        data: emptyDisplayDataOutput.data,
                        metadata: emptyDisplayDataOutput.metadata,
                        transient: { display_id }
                    })
                ];
            });
            // Mimic a situation where the cell outputs have not yet been updated in the DOM.
            notebook.cellAt(0).outputs.slice(0, notebook.cellAt(0).outputs.length);
            // Update the display data.
            await executeCellWithOutput(notebook.cellAt(1), codeToUpdateDisplayDataHello, 1, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromHelloUpdate.data,
                        metadata: outputsFromHelloUpdate.metadata,
                        transient: { display_id }
                    })
                ];
            });
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'Hello'
            );
            // Update the display data again.
            await executeCellWithOutput(notebook.cellAt(1), codeToUpdateDisplayDataWorld, 1, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromWorldUpdate.data,
                        metadata: outputsFromWorldUpdate.metadata,
                        transient: { display_id }
                    })
                ];
            });
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'World'
            );
        });
        test('Updates to two separate display updates in the same cell output', async () => {
            const notebook = createNotebook([
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: codeForTwoDisplayUpdates,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                }
            ]);
            const cell = notebook.cellAt(0);
            await executeCellWithOutput(cell, codeForTwoDisplayUpdates, 1, (producer) => {
                return outputsForTwoDisplayDataHelloWorld.map((item) =>
                    producer.displayOutput({
                        data: item.data,
                        metadata: item.metadata,
                        transient: item.transient as any
                    })
                );
            });
            assert.strictEqual(notebook.cellAt(0).outputs.length, 2);
            const output1 = translateCellDisplayOutput(notebook.cellAt(0).outputs[0]);
            assert.strictEqual((output1.transient as any).display_id, display_id);
            const output2 = translateCellDisplayOutput(notebook.cellAt(0).outputs[1]);
            assert.strictEqual((output2.transient as any).display_id, display_id2);
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'Hello'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[1].items[0].data).toString(),
                'World'
            );

            // Update the first display data.
            await executeCellWithOutput(notebook.cellAt(1), codeToUpdateDisplayData1ILike, 2, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromILikeUpdate.data,
                        metadata: outputsFromILikeUpdate.metadata,
                        transient: { display_id }
                    })
                ];
            });
            // await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1ILike, 2, outputsFromILikeUpdate);
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'I Like'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[1].items[0].data).toString(),
                'World'
            );

            // Update the second display data.
            await executeCellWithOutput(notebook.cellAt(2), codeToUpdateDisplayData1Pizza, 3, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromPizzaUpdate.data,
                        metadata: outputsFromPizzaUpdate.metadata,
                        transient: { display_id: display_id2 }
                    })
                ];
            });
            // await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1Pizza, 3, outputsFromPizzaUpdate);
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'I Like'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[1].items[0].data).toString(),
                'Pizza'
            );
        });

        test('Updates to two separate display updates in the same cell output (update second display update)', async () => {
            const notebook = createNotebook([
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: codeForTwoDisplayUpdates,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                }
            ]);
            const cell = notebook.cellAt(0);
            await executeCellWithOutput(cell, codeForTwoDisplayUpdates, 1, (producer) => {
                return outputsForTwoDisplayDataHelloWorld.map((item) =>
                    producer.displayOutput({
                        data: item.data,
                        metadata: item.metadata,
                        transient: item.transient as any
                    })
                );
            });

            assert.strictEqual(notebook.cellAt(0).outputs.length, 2);
            const output1 = translateCellDisplayOutput(notebook.cellAt(0).outputs[0]);
            assert.strictEqual((output1.transient as any).display_id, display_id);
            const output2 = translateCellDisplayOutput(notebook.cellAt(0).outputs[1]);
            assert.strictEqual((output2.transient as any).display_id, display_id2);
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'Hello'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[1].items[0].data).toString(),
                'World'
            );

            // Update the second display data.
            await executeCellWithOutput(notebook.cellAt(1), codeToUpdateDisplayData1Pizza, 2, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromPizzaUpdate.data,
                        metadata: outputsFromPizzaUpdate.metadata,
                        transient: { display_id: display_id2 }
                    })
                ];
            });

            // await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1Pizza, 2, outputsFromPizzaUpdate);
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'Hello'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[1].items[0].data).toString(),
                'Pizza'
            );

            // Update the first display data.
            await executeCellWithOutput(notebook.cellAt(2), codeToUpdateDisplayData1ILike, 3, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromILikeUpdate.data,
                        metadata: outputsFromILikeUpdate.metadata,
                        transient: { display_id }
                    })
                ];
            });
            // await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1ILike, 3, outputsFromILikeUpdate);
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'I Like'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[1].items[0].data).toString(),
                'Pizza'
            );
        });

        test('Updates to two separate display updates in the same cell output (even if Cell DOM has not yet been updated)', async () => {
            const notebook = createNotebook([
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: codeForTwoDisplayUpdates,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: addDisplayDataOutput,
                    outputs: []
                }
            ]);
            const cell = notebook.cellAt(0);
            await executeCellWithOutput(cell, codeForTwoDisplayUpdates, 1, (producer) => {
                return outputsForTwoDisplayDataHelloWorld.map((item) =>
                    producer.displayOutput({
                        data: item.data,
                        metadata: item.metadata,
                        transient: item.transient as any
                    })
                );
            });

            // Mimic a situation where the cell outputs have not yet been updated in the DOM.
            notebook.cellAt(0).outputs.slice(0, notebook.cellAt(0).outputs.length);

            // Update the second display data.
            await executeCellWithOutput(notebook.cellAt(1), codeToUpdateDisplayData1Pizza, 2, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromPizzaUpdate.data,
                        metadata: outputsFromPizzaUpdate.metadata,
                        transient: { display_id: display_id2 }
                    })
                ];
            });
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'Hello'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[1].items[0].data).toString(),
                'Pizza'
            );

            // Update the first display data.
            await executeCellWithOutput(notebook.cellAt(2), codeToUpdateDisplayData1ILike, 3, (producer) => {
                return [
                    producer.displayUpdate({
                        data: outputsFromILikeUpdate.data,
                        metadata: outputsFromILikeUpdate.metadata,
                        transient: { display_id }
                    })
                ];
            });
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'I Like'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[1].items[0].data).toString(),
                'Pizza'
            );
        });

        test('Updates display updates in the same cell output within the same execution (even if Cell DOM has not yet been updated) (Issue 12755, 13105, 13163)', async () => {
            const code = dedent`
                                from IPython import display
                                print("Touch me not")
                                display.display(display.HTML('<h1>A</h1>'), display_id='1')
                                print('Hello')
                                display.update_display(display.HTML('<h1>B</h1>'), display_id='1')
                                print('World')
                                display.update_display(display.HTML('<h1>C</h1>'), display_id='1')
                                print('Pizza')
                                `;
            const notebook = createNotebook([
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: code,
                    outputs: []
                }
            ]);
            await executeCellWithOutput(notebook.cellAt(0), code, 1, (producer) => {
                return [
                    producer.stream({ name: 'stdout', text: 'Touch me not\n' }),
                    producer.displayOutput({
                        data: {
                            'text/markdown': ['A'],
                            'text/plain': ['<IPython.core.display.HTML object>']
                        },
                        metadata: {},
                        transient: {
                            display_id: display_id
                        }
                    }),
                    producer.stream({ name: 'stdout', text: 'Hello\n' }),
                    producer.displayUpdate({
                        data: {
                            'text/markdown': ['B'],
                            'text/plain': ['<IPython.core.display.HTML object>']
                        },
                        metadata: {},
                        transient: {
                            display_id: display_id
                        }
                    }),
                    producer.stream({ name: 'stdout', text: 'World\n' }),
                    producer.displayUpdate({
                        data: {
                            'text/markdown': ['C'],
                            'text/plain': ['<IPython.core.display.HTML object>']
                        },
                        metadata: {},
                        transient: {
                            display_id: display_id
                        }
                    }),
                    producer.stream({ name: 'stdout', text: 'Pizza\n' })
                ];
            });
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[0].items[0].data).toString(),
                'Touch me not\n'
            );
            assert.strictEqual(new TextDecoder().decode(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'C');
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[2].items[0].data).toString(),
                'Hello\n'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[2].items[1].data).toString(),
                'World\n'
            );
            assert.strictEqual(
                new TextDecoder().decode(notebook.cellAt(0).outputs[2].items[2].data).toString(),
                'Pizza\n'
            );
        });
    });

    suite('Resume Cell Execution', () => {
        const print1To100 = dedent`
                                import time
                                for i in range(100):
                                    time.sleep(1)
                                    print(i)
                                `;
        const outputFor1To10 = new NotebookCellOutput([
            NotebookCellOutputItem.stdout('0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n')
        ]);
        test('Execute cell and resume cell execution on reload', async () => testResumingExecution(false));
        test('Execute cell and resume cell execution on reload (with reply message)', async () =>
            testResumingExecution(false));
        async function testResumingExecution(markEndOfExecutionWithReplyMessage: boolean) {
            const notebook = createNotebook([
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: print1To100,
                    outputs: [outputFor1To10]
                }
            ]);
            const cell = notebook.cellAt(0);
            const { request, handler, producer } = sendRequest(cell, print1To100);
            fakeSocket.emitOnMessage(producer.status('busy'));
            fakeSocket.emitOnMessage(producer.execInput(1));
            Array.from({ length: 50 }, (_, i) => {
                fakeSocket.emitOnMessage(producer.stream({ name: 'stdout', text: `${i}\n` }));
            });

            await waitForCondition(
                () => cell.outputs.length === 1,
                100,
                () => `Cell should have 1 output, but got ${cell.outputs.length}`
            );
            await waitForCondition(
                () => cell.outputs[0].items.length === 50,
                100,
                () => `Cell output should have 50 output items, but got ${cell.outputs[0].items.length}`
            );
            for (let index = 0; index < cell.outputs[0].items.length; index++) {
                const item = cell.outputs[0].items[index];
                assert.strictEqual(item.mime, 'application/vnd.code.notebook.stdout');
                assert.strictEqual(new TextDecoder().decode(item.data).toString(), `${index}\n`);
            }

            // Now assume we closed VS Code, and then opened it again.
            // At this point we need to resume the execution of the cell.
            handler.dispose();
            request.dispose();

            // Resume cell execution
            const { handler: handler2 } = resumeExecution(cell, request.msg.header.msg_id);

            // Assume we start seeing outputs from 75 onwards, the others 50 to 74 are lost, as they were sent when vscode was closed.
            Array.from({ length: 25 }, (_, i) => {
                fakeSocket.emitOnMessage(producer.stream({ name: 'stdout', text: `${75 + i}\n` }));
            });
            fakeSocket.emitOnMessage(producer.status('idle'));
            if (markEndOfExecutionWithReplyMessage) {
                // This message marks the completion of the message.
                fakeSocket.emitOnMessage(producer.reply(1));
            } else {
                // When VSC connects to a remote kernel session, we send a kernel info message,
                // Getting a response for that marks the completion of the previous message.
                fakeSocket.emitOnMessage(createMessageProducers(msgIdProducer).forKernelInfo().reply());
            }

            await handler2.completed;
            await waitForCondition(
                () => cell.outputs[0].items.length === 75,
                100,
                () => `Cell output should have 75 output items, but got ${cell.outputs[0].items.length}`
            );

            for (let index = 0; index < cell.outputs[0].items.length; index++) {
                const item = cell.outputs[0].items[index];
                assert.strictEqual(item.mime, 'application/vnd.code.notebook.stdout');
                if (index >= 50) {
                    assert.strictEqual(new TextDecoder().decode(item.data).toString(), `${25 + index}\n`);
                } else {
                    assert.strictEqual(new TextDecoder().decode(item.data).toString(), `${index}\n`);
                }
            }
        }

        function resumeExecution(cell: NotebookCell, msg_id: string) {
            const handler = messageHandlerService.registerListenerForResumingExecution(cell, {
                kernel,
                msg_id,
                cellExecution: createKernelController().createNotebookCellExecution(cell)
            });
            handler.onErrorHandlingExecuteRequestIOPubMessage(
                (ex) => (messageHandlingFailure = ex.error),
                undefined,
                disposables
            );
            disposables.push(handler);
            return { handler };
        }
    });
});
