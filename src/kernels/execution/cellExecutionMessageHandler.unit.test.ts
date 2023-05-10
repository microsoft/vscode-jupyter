// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Signal } from '@lumino/signaling';
import { assert } from 'chai';
import { createMockedNotebookDocument } from '../../test/datascience/editor-integration/helpers';
import { CancellationTokenSource, Disposable, NotebookCellKind, NotebookDocument } from 'vscode';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import dedent from 'dedent';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IApplicationShell } from '../../platform/common/application/types';
import { IKernelController } from '../types';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { instance, mock, when } from 'ts-mockito';
import { MockJupyterRequestICell } from '../../test/datascience/mockJupyterRequest';
import { IDisplayData, IDisplayUpdate, IOutput } from '@jupyterlab/nbformat';
import { CellExecutionMessageHandlerService } from './cellExecutionMessageHandlerService';
import { noop } from '../../test/core';
import { createKernelController } from '../../test/datascience/notebook/executionHelper';
import { translateCellDisplayOutput } from './helpers';

suite(`Cell Execution Message Handler`, () => {
    suite('Display Updates with Metadata changes', () => {
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
        const outputsFromHelloUpdate: IDisplayUpdate[] = [
            {
                data: {
                    'text/markdown': 'Hello',
                    'text/plain': '<IPython.core.display.Markdown object>'
                },
                transient: {
                    display_id: display_id
                },
                metadata: {},
                output_type: 'update_display_data'
            }
        ];
        const outputsFromWorldUpdate: IDisplayUpdate[] = [
            {
                data: {
                    'text/markdown': 'World',
                    'text/plain': '<IPython.core.display.Markdown object>'
                },
                transient: {
                    display_id: display_id
                },
                metadata: {},
                output_type: 'update_display_data'
            }
        ];

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
        const outputsFromILikeUpdate: IDisplayUpdate[] = [
            {
                data: {
                    'text/markdown': 'I Like',
                    'text/plain': '<IPython.core.display.Markdown object>'
                },
                transient: {
                    display_id: display_id
                },
                metadata: {},
                output_type: 'update_display_data'
            }
        ];
        const outputsFromPizzaUpdate: IDisplayUpdate[] = [
            {
                data: {
                    'text/markdown': 'Pizza',
                    'text/plain': '<IPython.core.display.Markdown object>'
                },
                transient: {
                    display_id: display_id2
                },
                metadata: {},
                output_type: 'update_display_data'
            }
        ];

        const disposables: IDisposable[] = [];
        let appShell: IApplicationShell;
        let controller: IKernelController;
        let context: IExtensionContext;
        let kernel: Kernel.IKernelConnection;
        let messageHandlerService: CellExecutionMessageHandlerService;
        let ioPubMessageEmitter: Signal<Kernel.IKernelConnection, KernelMessage.IIOPubMessage>;
        let tokenSource: CancellationTokenSource;
        let messageHandlingFailure: undefined | Error;
        setup(() => {
            messageHandlingFailure = undefined;
            tokenSource = new CancellationTokenSource();
            disposables.push(tokenSource);
            appShell = mock<IApplicationShell>();
            controller = createKernelController();
            context = mock<IExtensionContext>();
            kernel = mock<Kernel.IKernelConnection>();
            ioPubMessageEmitter = new Signal<Kernel.IKernelConnection, KernelMessage.IIOPubMessage>(instance(kernel));
            when(kernel.anyMessage).thenReturn({ connect: noop, disconnect: noop } as any);
            when(kernel.iopubMessage).thenReturn(ioPubMessageEmitter);
            disposables.push(new Disposable(() => ioPubMessageEmitter.disconnect(noop)));
            messageHandlerService = new CellExecutionMessageHandlerService(
                instance(appShell),
                controller,
                instance(context),
                []
            );
            disposables.push(messageHandlerService);
        });
        teardown(() => disposeAllDisposables(disposables));

        test('Execute cell and add output (Issue 8621)', async () => {
            const notebook = createMockedNotebookDocument([
                { kind: NotebookCellKind.Code, languageId: PYTHON_LANGUAGE, value: imageCell, outputs: [] },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: 'h.update(Image(img, width=500, height=500))',
                    outputs: []
                }
            ]);
            await executeAndDisplayImage(notebook);
        });
        test('Execute cell and update Display Data with metadata (Issue 8621)', async () => {
            const notebook = createMockedNotebookDocument([
                { kind: NotebookCellKind.Code, languageId: PYTHON_LANGUAGE, value: imageCell, outputs: [] },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: 'h.update(Image(img, width=500, height=500))',
                    outputs: []
                }
            ]);
            await executeAndDisplayImage(notebook);

            // Now update the display data of the first cell from the second cell
            await executeAndUpdateDisplayImage(notebook);
        });
        test('Execute cell and update Display Data with metadata (even if Cell DOM has not yet been updated) (Issue 8621)', async () => {
            const notebook = createMockedNotebookDocument([
                { kind: NotebookCellKind.Code, languageId: PYTHON_LANGUAGE, value: imageCell, outputs: [] },
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: 'h.update(Image(img, width=500, height=500))',
                    outputs: []
                }
            ]);
            await executeAndDisplayImage(notebook);

            // Mimic a situation where the cell outputs have not yet been updated in the DOM.
            notebook.cellAt(0).outputs.slice(0, notebook.cellAt(0).outputs.length);

            // Now update the display data of the first cell from the second cell
            await executeAndUpdateDisplayImage(notebook);
        });
        test('Execute cell and add Display output', async () => {
            const notebook = createMockedNotebookDocument([
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
            await executeCellWithDisplayData(notebook, addDisplayDataOutput);

            // Update the display data.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayDataHello, 2, outputsFromHelloUpdate);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');

            // Update the display data again.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayDataWorld, 3, outputsFromWorldUpdate);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'World');
        });

        test('Execute cell and add Display output (even if Cell DOM has not yet been updated) ', async () => {
            const notebook = createMockedNotebookDocument([
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
            await executeCellWithDisplayData(notebook, addDisplayDataOutput);

            // Mimic a situation where the cell outputs have not yet been updated in the DOM.
            notebook.cellAt(0).outputs.slice(0, notebook.cellAt(0).outputs.length);

            // Update the display data.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayDataHello, 2, outputsFromHelloUpdate);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');

            // Update the display data again.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayDataWorld, 3, outputsFromWorldUpdate);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'World');
        });
        test('Updates to two separate display updates in the same cell output', async () => {
            const notebook = createMockedNotebookDocument([
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
            await executeCellWithDisplayData(notebook, codeForTwoDisplayUpdates, outputsForTwoDisplayDataHelloWorld);

            assert.strictEqual(notebook.cellAt(0).outputs.length, 2);
            const output1 = translateCellDisplayOutput(notebook.cellAt(0).outputs[0]);
            assert.strictEqual((output1.transient as any).display_id, display_id);
            const output2 = translateCellDisplayOutput(notebook.cellAt(0).outputs[1]);
            assert.strictEqual((output2.transient as any).display_id, display_id2);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'World');

            // Update the first display data.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1ILike, 2, outputsFromILikeUpdate);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'I Like');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'World');

            // Update the second display data.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1Pizza, 3, outputsFromPizzaUpdate);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'I Like');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'Pizza');
        });

        test('Updates to two separate display updates in the same cell output (update second display update)', async () => {
            const notebook = createMockedNotebookDocument([
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
            await executeCellWithDisplayData(notebook, codeForTwoDisplayUpdates, outputsForTwoDisplayDataHelloWorld);

            assert.strictEqual(notebook.cellAt(0).outputs.length, 2);
            const output1 = translateCellDisplayOutput(notebook.cellAt(0).outputs[0]);
            assert.strictEqual((output1.transient as any).display_id, display_id);
            const output2 = translateCellDisplayOutput(notebook.cellAt(0).outputs[1]);
            assert.strictEqual((output2.transient as any).display_id, display_id2);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'World');

            // Update the second display data.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1Pizza, 2, outputsFromPizzaUpdate);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'Pizza');

            // Update the first display data.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1ILike, 3, outputsFromILikeUpdate);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'I Like');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'Pizza');
        });

        test('Updates to two separate display updates in the same cell output (even if Cell DOM has not yet been updated)', async () => {
            const notebook = createMockedNotebookDocument([
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
            await executeCellWithDisplayData(notebook, codeForTwoDisplayUpdates, outputsForTwoDisplayDataHelloWorld);

            // Mimic a situation where the cell outputs have not yet been updated in the DOM.
            notebook.cellAt(0).outputs.slice(0, notebook.cellAt(0).outputs.length);

            // Update the second display data.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1Pizza, 2, outputsFromPizzaUpdate);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Hello');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'Pizza');

            // Update the first display data.
            await executeAndUpdateDisplayData(notebook, codeToUpdateDisplayData1ILike, 3, outputsFromILikeUpdate);

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
            const notebook = createMockedNotebookDocument([
                {
                    kind: NotebookCellKind.Code,
                    languageId: PYTHON_LANGUAGE,
                    value: code,
                    outputs: []
                }
            ]);
            const outputs: IOutput[] = [
                {
                    name: 'stdout',
                    output_type: 'stream',
                    text: 'Touch me not\n'
                },
                {
                    data: {
                        'text/markdown': ['A'],
                        'text/plain': ['<IPython.core.display.HTML object>']
                    },
                    metadata: {},
                    transient: {
                        display_id: display_id
                    },
                    output_type: 'display_data'
                },
                {
                    name: 'stdout',
                    output_type: 'stream',
                    text: 'Hello\n'
                },
                {
                    data: {
                        'text/markdown': ['B'],
                        'text/plain': ['<IPython.core.display.HTML object>']
                    },
                    metadata: {},
                    transient: {
                        display_id: display_id
                    },
                    output_type: 'update_display_data'
                },
                {
                    name: 'stdout',
                    output_type: 'stream',
                    text: 'World\n'
                },
                {
                    data: {
                        'text/markdown': ['C'],
                        'text/plain': ['<IPython.core.display.HTML object>']
                    },
                    metadata: {},
                    transient: {
                        display_id: display_id
                    },
                    output_type: 'update_display_data'
                },
                {
                    name: 'stdout',
                    output_type: 'stream',
                    text: 'Pizza\n'
                }
            ];
            await executeCellWithDisplayData(notebook, code, outputs);

            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[0].items[0].data).toString(), 'Touch me not\n');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[1].items[0].data).toString(), 'C');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[2].items[0].data).toString(), 'Hello\n');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[2].items[1].data).toString(), 'World\n');
            assert.strictEqual(Buffer.from(notebook.cellAt(0).outputs[2].items[2].data).toString(), 'Pizza\n');
        });

        async function executeCellWithDisplayData(
            notebook: NotebookDocument,
            code: string,
            outputs: IOutput[] = [Object.assign({}, emptyDisplayDataOutput, { transient: { display_id } })]
        ) {
            const request1 = new MockJupyterRequestICell(
                {
                    data: {
                        cell_type: 'code',
                        execution_count: 1,
                        metadata: {},
                        outputs,
                        source: code
                    }
                },
                1,
                1,
                tokenSource.token,
                ioPubMessageEmitter
            );
            const handler = messageHandlerService.registerListenerForExecution(notebook.cellAt(0), {
                kernel: instance(kernel),
                request: request1,
                cellExecution: createKernelController().createNotebookCellExecution(notebook.cellAt(0))
            });
            handler.onErrorHandlingExecuteRequestIOPubMessage(
                (ex) => (messageHandlingFailure = ex.error),
                undefined,
                disposables
            );
            disposables.push(handler);

            await request1.done;

            assert.isUndefined(messageHandlingFailure);
            assert.isAtLeast(notebook.cellAt(0).outputs.length, 1);
            const output = translateCellDisplayOutput(notebook.cellAt(0).outputs[0]);
            if (outputs[0].transient) {
                assert.strictEqual((output.transient as any).display_id, display_id);
            }
        }

        async function executeAndUpdateDisplayData(
            notebook: NotebookDocument,
            code: string,
            executionCount: number,
            outputs: IOutput[]
        ) {
            // Now update the display data of the first cell from the second cell
            const request2 = new MockJupyterRequestICell(
                {
                    data: {
                        cell_type: 'code',
                        execution_count: executionCount,
                        metadata: {},
                        outputs,
                        source: code
                    }
                },
                1,
                1,
                tokenSource.token,
                ioPubMessageEmitter
            );
            const handler2 = messageHandlerService.registerListenerForExecution(notebook.cellAt(1), {
                kernel: instance(kernel),
                request: request2,
                cellExecution: createKernelController().createNotebookCellExecution(notebook.cellAt(1))
            });
            disposables.push(handler2);
            handler2.onErrorHandlingExecuteRequestIOPubMessage(
                (ex) => (messageHandlingFailure = ex.error),
                undefined,
                disposables
            );

            await request2.done;

            assert.isUndefined(messageHandlingFailure);
        }

        async function executeAndDisplayImage(notebook: NotebookDocument) {
            const request1 = new MockJupyterRequestICell(
                {
                    data: {
                        cell_type: 'code',
                        execution_count: 1,
                        metadata: {},
                        outputs: [Object.assign({}, imageOutput, { transient: { display_id: 'displayIdXYZ' } })],
                        source: imageCell
                    }
                },
                1,
                1,
                tokenSource.token,
                ioPubMessageEmitter
            );
            const handler = messageHandlerService.registerListenerForExecution(notebook.cellAt(0), {
                kernel: instance(kernel),
                request: request1,
                cellExecution: createKernelController().createNotebookCellExecution(notebook.cellAt(0))
            });
            disposables.push(handler);
            handler.onErrorHandlingExecuteRequestIOPubMessage(
                (ex) => (messageHandlingFailure = ex.error),
                undefined,
                disposables
            );

            await request1.done;

            assert.isUndefined(messageHandlingFailure);
            assert.strictEqual(notebook.cellAt(0).outputs.length, 1);
            const output = translateCellDisplayOutput(notebook.cellAt(0).outputs[0]);
            delete output.transient;
            assert.deepEqual(output, imageOutput);
        }
        async function executeAndUpdateDisplayImage(notebook: NotebookDocument) {
            // Now update the display data of the first cell from the second cell
            const request2 = new MockJupyterRequestICell(
                {
                    data: {
                        cell_type: 'code',
                        execution_count: 2,
                        metadata: {},
                        outputs: [Object.assign({}, imageUpdateOutput, { transient: { display_id: 'displayIdXYZ' } })],
                        source: 'h.update(Image(img, width=500, height=500))'
                    }
                },
                1,
                1,
                tokenSource.token,
                ioPubMessageEmitter
            );
            const handler2 = messageHandlerService.registerListenerForExecution(notebook.cellAt(1), {
                kernel: instance(kernel),
                request: request2,
                cellExecution: createKernelController().createNotebookCellExecution(notebook.cellAt(1))
            });
            disposables.push(handler2);
            handler2.onErrorHandlingExecuteRequestIOPubMessage(
                (ex) => (messageHandlingFailure = ex.error),
                undefined,
                disposables
            );

            await request2.done;

            assert.isUndefined(messageHandlingFailure);
            assert.strictEqual(notebook.cellAt(0).outputs.length, 1);
            const output2 = translateCellDisplayOutput(notebook.cellAt(0).outputs[0]);
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
        }
    });
});
