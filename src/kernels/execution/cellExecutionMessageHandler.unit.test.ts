// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { createMockedNotebookDocument } from '../../test/datascience/editor-integration/helpers';
import {
    CancellationTokenSource,
    NotebookCell,
    NotebookCellData,
    NotebookCellKind,
    NotebookCellOutput,
    NotebookCellOutputItem
} from 'vscode';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import dedent from 'dedent';
import { dispose } from '../../platform/common/utils/lifecycle';
import { IKernelController } from '../types';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { instance, mock } from 'ts-mockito';
import type { IDisplayData, IDisplayUpdate } from '@jupyterlab/nbformat';
import { CellExecutionMessageHandlerService } from './cellExecutionMessageHandlerService';
import { createKernelController } from '../../test/datascience/notebook/executionHelper';
import { translateCellDisplayOutput } from './helpers';
import {
    IFakeSocket,
    MsgIdProducer,
    createKernelConnection,
    createMessageProducers
} from '../../test/datascience/fakeKernelConnection.node';
import { JupyterRequestCreator } from '../jupyter/session/jupyterRequestCreator.node';
import { waitForCondition } from '../../test/common';

suite(`Cell Execution Message Handler`, () => {
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
        messageHandlerService = new CellExecutionMessageHandlerService(controller, instance(context), [], notebook);
        disposables.push(messageHandlerService);
        return notebook;
    }
    function sendRequest(cell: NotebookCell, code: string) {
        const request = kernel.requestExecute({
            code,
            allow_stdin: true,
            silent: false,
            stop_on_error: true,
            store_history: true
        });
        const producer = createMessageProducers(msgIdProducer).forExecRequest(request);
        const handler = messageHandlerService.registerListenerForResumingExecution(cell, {
            kernel,
            msg_id: request.msg.header.msg_id,
            cellExecution: createKernelController().createNotebookCellExecution(cell)
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
            ) => KernelMessage.IMessage<KernelMessage.MessageType>[]
        ) {
            // Now update the display data of the first cell from the second cell
            const { request, producer } = sendRequest(cell, code);

            fakeSocket.emitOnMessage(producer.status('busy'));
            fakeSocket.emitOnMessage(producer.execInput(executionCount));
            messageGenerator(producer).forEach((msg) => fakeSocket.emitOnMessage(msg));
            fakeSocket.emitOnMessage(producer.status('idle'));
            fakeSocket.emitOnMessage(producer.reply(executionCount));

            await request.done;

            assert.isUndefined(messageHandlingFailure);
        }

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
                { kind: NotebookCellKind.Code, languageId: PYTHON_LANGUAGE, value: addDisplayDataOutput, outputs: [] },
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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'World');
        });

        test('Execute cell and add Display output (even if Cell DOM has not yet been updated) ', async () => {
            const notebook = createNotebook([
                { kind: NotebookCellKind.Code, languageId: PYTHON_LANGUAGE, value: addDisplayDataOutput, outputs: [] },
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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'World');
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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'World');

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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'I Like');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'World');

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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'I Like');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'Pizza');
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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'World');

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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'Pizza');

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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'I Like');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'Pizza');
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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'Pizza');

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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'I Like');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'Pizza');
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
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Touch me not\n');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'C');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[2].items[0].data).toString(), 'Hello\n');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[2].items[1].data).toString(), 'World\n');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[2].items[2].data).toString(), 'Pizza\n');
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
                assert.strictEqual(Buffer.from(item.data).toString(), `${index}\n`);
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
                    assert.strictEqual(Buffer.from(item.data).toString(), `${25 + index}\n`);
                } else {
                    assert.strictEqual(Buffer.from(item.data).toString(), `${index}\n`);
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
