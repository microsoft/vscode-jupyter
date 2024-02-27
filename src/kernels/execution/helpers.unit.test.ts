// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import type * as nbformat from '@jupyterlab/nbformat';
import { assert } from 'chai';
import { Uri } from 'vscode';
import { cellOutputToVSCCellOutput, getNotebookCellOutputMetadata, updateNotebookMetadata } from './helpers';
import { IJupyterKernelSpec, PythonKernelConnectionMetadata } from '../types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { PythonExtension } from '@vscode/python-extension';
import { instance, mock, when } from 'ts-mockito';
import { resolvableInstance } from '../../test/datascience/helpers';
import { setPythonApi } from '../../platform/interpreter/helpers';
import { dispose } from '../../platform/common/utils/lifecycle';

// Function return type
// type updateNotebookMetadataReturn = { changed: boolean; kernelId: string | undefined };
suite(`UpdateNotebookMetadata`, () => {
    const python36Global: PythonEnvironment = {
        uri: Uri.file('/usr/bin/python36'),
        id: Uri.file('/usr/bin/python36').fsPath,
        displayName: 'Python 3.6'
    };
    const pythonDefaultKernelSpec: IJupyterKernelSpec = {
        argv: ['python', '-f', '{connection_file}'],
        display_name: 'Python Default',
        name: 'python3',
        executable: 'python'
    };
    const python37Global: PythonEnvironment = {
        uri: Uri.file('/usr/bin/python37'),
        id: Uri.file('/usr/bin/python37').fsPath,
        displayName: 'Python 3.7'
    };
    let environments: PythonExtension['environments'];
    let disposables: { dispose: () => void }[] = [];
    setup(() => {
        const mockedApi = mock<PythonExtension>();
        sinon.stub(PythonExtension, 'api').resolves(resolvableInstance(mockedApi));
        disposables.push({ dispose: () => sinon.restore() });
        environments = mock<PythonExtension['environments']>();
        when(mockedApi.environments).thenReturn(instance(environments));
        when(environments.known).thenReturn([
            {
                id: python36Global.id,
                version: { major: 3, minor: 6, micro: 0, sysVersion: '3.6.0' }
            } as any,
            {
                id: python37Global.id,
                version: { major: 3, minor: 7, micro: 0, sysVersion: '3.7.0' }
            } as any
        ]);
        setPythonApi(instance(mockedApi));
        disposables.push({ dispose: () => setPythonApi(undefined as any) });
    });
    teardown(() => {
        disposables = dispose(disposables);
    });
    test('Empty call does not change anything', async () => {
        const value = await updateNotebookMetadata();
        assert.strictEqual(value.changed, false);
    });
    test('Ensure Language', async () => {
        const notebookMetadata = { orig_nbformat: 4 };
        const value = await updateNotebookMetadata(notebookMetadata);

        // Verify lang info added
        verifyMetadata(notebookMetadata, { orig_nbformat: 4, language_info: { name: '' } });
        assert.strictEqual(value.changed, false);
    });
    test('Update Language', async () => {
        const notebookMetadata = { orig_nbformat: 4, language_info: { name: 'JUNK' } };
        const kernelConnection = PythonKernelConnectionMetadata.create({
            id: 'python36',
            interpreter: python36Global,
            kernelSpec: pythonDefaultKernelSpec
        });
        const value = await updateNotebookMetadata(notebookMetadata, kernelConnection);

        // Verify lang info added
        verifyMetadata(notebookMetadata, {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        });
        assert.strictEqual(value.changed, true);
    });

    test('Update Python Version', async () => {
        const notebookMetadata = { orig_nbformat: 4, language_info: { name: 'python', version: '3.6.0' } };
        const kernelConnection = PythonKernelConnectionMetadata.create({
            id: 'python36',
            interpreter: python37Global,
            kernelSpec: pythonDefaultKernelSpec
        });
        const value = await updateNotebookMetadata(notebookMetadata, kernelConnection);

        // Verify version updated 3.6 => 3.7
        verifyMetadata(notebookMetadata, {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.7.0' }
        });
        assert.strictEqual(value.changed, true);
    });

    test('New KernelSpec Name / Display Name', async () => {
        const notebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'JUNK DISPLAYNAME', language: 'python', name: 'JUNK' },
            language_info: { name: 'python', version: '3.6.0' }
        };
        const kernelConnection = PythonKernelConnectionMetadata.create({
            id: 'python36',
            interpreter: python36Global,
            kernelSpec: pythonDefaultKernelSpec
        });
        const value = await updateNotebookMetadata(notebookMetadata, kernelConnection);

        // Verify kernel_spec name updated JUNK => python3
        verifyMetadata(notebookMetadata, {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        });
        assert.strictEqual(value.changed, true);
    });

    test('No Change', async () => {
        let notebookMetadata: nbformat.INotebookMetadata = {
            orig_nbformat: 4,
            vscode: {
                interpreter: {
                    hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
                }
            },
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        };
        notebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        };
        const kernelConnection = PythonKernelConnectionMetadata.create({
            id: 'python36',
            interpreter: python36Global,
            kernelSpec: pythonDefaultKernelSpec
        });
        const value = await updateNotebookMetadata(notebookMetadata, kernelConnection);

        // Verify display_name updated due to interpreter hash change
        verifyMetadata(notebookMetadata, {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        });
        // Should be no change here
        assert.strictEqual(value.changed, false);
    });
    test('No Change (old format)', async () => {
        let notebookMetadata: nbformat.INotebookMetadata = {
            orig_nbformat: 4,
            interpreter: {
                hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
            },

            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        };
        let newNotebookMetadata: nbformat.INotebookMetadata = {
            orig_nbformat: 4,
            vscode: {
                interpreter: {
                    hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
                }
            },

            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        };
        notebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        };

        newNotebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        };
        const kernelConnection = PythonKernelConnectionMetadata.create({
            id: 'python36',
            interpreter: python36Global,
            kernelSpec: pythonDefaultKernelSpec
        });
        const value = await updateNotebookMetadata(notebookMetadata, kernelConnection);

        // Verify display_name updated due to interpreter hash change
        verifyMetadata(newNotebookMetadata, {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        });

        // Should be no change here
        assert.strictEqual(value.changed, false);
    });
});

function verifyMetadata(actualMetadata: nbformat.INotebookMetadata, targetMetadata: nbformat.INotebookMetadata) {
    assert.deepEqual(actualMetadata, targetMetadata);
}

suite('Cell Metadata', () => {
    test('Verify Cell Metadta', () => {
        const displayDataOutput: nbformat.IOutput = {
            data: {
                'application/vnd.custom': { one: 1, two: 2 },
                'text/plain': 'Hello World'
            },
            execution_count: 1,
            output_type: 'display_data',
            transient: {
                display_id: '123'
            },
            metadata: {
                foo: 'bar'
            }
        };

        const cellOutput = cellOutputToVSCCellOutput(displayDataOutput);
        const metadata = getNotebookCellOutputMetadata(cellOutput);
        assert.deepEqual(metadata?.metadata, displayDataOutput.metadata);
        assert.strictEqual(metadata?.executionCount, displayDataOutput.execution_count);
        assert.strictEqual(metadata?.outputType, displayDataOutput.output_type);
        assert.strictEqual(metadata?.transient, displayDataOutput.transient);
    });
});
