// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import { CommandManager } from '../../platform/common/application/commandManager';
import { DocumentManager } from '../../platform/common/application/documentManager';
import { IDocumentManager } from '../../platform/common/application/types';
import { JupyterSettings } from '../../platform/common/configSettings';
import { ConfigurationService } from '../../platform/common/configuration/service.node';
import { IConfigurationService, IWatchableJupyterSettings } from '../../platform/common/types';
import { GlobalActivation } from '../../standalone/activation/globalActivation';
import { RawNotebookSupportedService } from '../../kernels/raw/session/rawNotebookSupportedService.node';
import { IRawNotebookSupportedService } from '../../kernels/raw/types';
import { pruneCell } from '../../platform/common/utils';

/* eslint-disable  */
suite('Tests', () => {
    let dataScience: GlobalActivation;
    let cmdManager: CommandManager;
    let configService: IConfigurationService;
    let docManager: IDocumentManager;
    let settings: IWatchableJupyterSettings;
    let onDidChangeSettings: sinon.SinonStub;
    let onDidChangeActiveTextEditor: sinon.SinonStub;
    let rawNotebookSupported: IRawNotebookSupportedService;
    setup(() => {
        cmdManager = mock(CommandManager);
        configService = mock(ConfigurationService);
        docManager = mock(DocumentManager);
        settings = mock(JupyterSettings);
        rawNotebookSupported = mock(RawNotebookSupportedService);

        dataScience = new GlobalActivation(
            instance(cmdManager),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [] as any,
            instance(configService),
            instance(docManager),
            instance(rawNotebookSupported),
            [] as any
        );

        onDidChangeSettings = sinon.stub();
        onDidChangeActiveTextEditor = sinon.stub();
        when(configService.getSettings(anything())).thenReturn(instance(settings));
        when(settings.onDidChange).thenReturn(onDidChangeSettings);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(docManager.onDidChangeActiveTextEditor).thenReturn(onDidChangeActiveTextEditor);
        when(rawNotebookSupported.isSupported).thenReturn(Promise.resolve(true));
    });

    suite('Activate', () => {
        setup(async () => {
            await dataScience.activate();
        });

        test('Should add handler for Settings Changed', async () => {
            assert.ok(onDidChangeSettings.calledOnce);
        });
        test('Should add handler for ActiveTextEditorChanged', async () => {
            assert.ok(onDidChangeActiveTextEditor.calledOnce);
        });
    });

    suite('Cell pruning', () => {
        test('Remove output and execution count from non code', () => {
            const cell: nbformat.ICell = {
                cell_type: 'markdown',
                outputs: [],
                execution_count: '23',
                source: 'My markdown',
                metadata: {}
            };
            const result = pruneCell(cell);
            assert.equal(Object.keys(result).indexOf('outputs'), -1, 'Outputs inside markdown');
            assert.equal(Object.keys(result).indexOf('execution_count'), -1, 'Execution count inside markdown');
        });
        test('Outputs dont contain extra data', () => {
            const cell: nbformat.ICell = {
                cell_type: 'code',
                outputs: [
                    {
                        output_type: 'display_data',
                        extra: {}
                    }
                ],
                execution_count: '23',
                source: 'My source',
                metadata: {}
            };
            const result = pruneCell(cell);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.equal((result.outputs as any).length, 1, 'Outputs were removed');
            assert.equal(result.execution_count, '23', 'Output execution count removed');
            const output = (result.outputs as nbformat.IOutput[])[0];
            assert.equal(Object.keys(output).indexOf('extra'), -1, 'Output still has extra data');
            assert.notEqual(Object.keys(output).indexOf('output_type'), -1, 'Output is missing output_type');
        });
        test('Display outputs still have their data', () => {
            const cell: nbformat.ICell = {
                cell_type: 'code',
                execution_count: 2,
                metadata: {},
                outputs: [
                    {
                        output_type: 'display_data',
                        data: {
                            'text/plain': "Box(children=(Label(value='My label'),))",
                            'application/vnd.jupyter.widget-view+json': {
                                version_major: 2,
                                version_minor: 0,
                                model_id: '90c99248d7bb490ca132427de6d1e235'
                            }
                        },
                        metadata: { bob: 'youruncle' }
                    }
                ],
                source: ["line = widgets.Label('My label')\n", 'box = widgets.Box([line])\n', 'box']
            };

            const result = pruneCell(cell);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.equal((result.outputs as any).length, 1, 'Outputs were removed');
            assert.equal(result.execution_count, 2, 'Output execution count removed');
            assert.deepEqual(result.outputs, cell.outputs, 'Outputs were modified');
        });
        test('Stream outputs still have their data', () => {
            const cell: nbformat.ICell = {
                cell_type: 'code',
                execution_count: 2,
                metadata: {},
                outputs: [
                    {
                        output_type: 'stream',
                        name: 'stdout',
                        text: 'foobar'
                    }
                ],
                source: ["line = widgets.Label('My label')\n", 'box = widgets.Box([line])\n', 'box']
            };

            const result = pruneCell(cell);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.equal((result.outputs as any).length, 1, 'Outputs were removed');
            assert.equal(result.execution_count, 2, 'Output execution count removed');
            assert.deepEqual(result.outputs, cell.outputs, 'Outputs were modified');
        });
        test('Errors outputs still have their data', () => {
            const cell: nbformat.ICell = {
                cell_type: 'code',
                execution_count: 2,
                metadata: {},
                outputs: [
                    {
                        output_type: 'error',
                        ename: 'stdout',
                        evalue: 'stdout is a value',
                        traceback: ['more']
                    }
                ],
                source: ["line = widgets.Label('My label')\n", 'box = widgets.Box([line])\n', 'box']
            };

            const result = pruneCell(cell);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.equal((result.outputs as any).length, 1, 'Outputs were removed');
            assert.equal(result.execution_count, 2, 'Output execution count removed');
            assert.deepEqual(result.outputs, cell.outputs, 'Outputs were modified');
        });
        test('Execute result outputs still have their data', () => {
            const cell: nbformat.ICell = {
                cell_type: 'code',
                execution_count: 2,
                metadata: {},
                outputs: [
                    {
                        output_type: 'execute_result',
                        execution_count: '4',
                        data: {
                            'text/plain': "Box(children=(Label(value='My label'),))",
                            'application/vnd.jupyter.widget-view+json': {
                                version_major: 2,
                                version_minor: 0,
                                model_id: '90c99248d7bb490ca132427de6d1e235'
                            }
                        },
                        metadata: { foo: 'bar' }
                    }
                ],
                source: ["line = widgets.Label('My label')\n", 'box = widgets.Box([line])\n', 'box']
            };

            const result = pruneCell(cell);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.equal((result.outputs as any).length, 1, 'Outputs were removed');
            assert.equal(result.execution_count, 2, 'Output execution count removed');
            assert.deepEqual(result.outputs, cell.outputs, 'Outputs were modified');
        });
        test('Unrecognized outputs still have their data', () => {
            const cell: nbformat.ICell = {
                cell_type: 'code',
                execution_count: 2,
                metadata: {},
                outputs: [
                    {
                        output_type: 'unrecognized',
                        execution_count: '4',
                        data: {
                            'text/plain': "Box(children=(Label(value='My label'),))",
                            'application/vnd.jupyter.widget-view+json': {
                                version_major: 2,
                                version_minor: 0,
                                model_id: '90c99248d7bb490ca132427de6d1e235'
                            }
                        },
                        metadata: {}
                    }
                ],
                source: ["line = widgets.Label('My label')\n", 'box = widgets.Box([line])\n', 'box']
            };

            const result = pruneCell(cell);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.equal((result.outputs as any).length, 1, 'Outputs were removed');
            assert.equal(result.execution_count, 2, 'Output execution count removed');
            assert.deepEqual(result.outputs, cell.outputs, 'Outputs were modified');
        });
    });
});
