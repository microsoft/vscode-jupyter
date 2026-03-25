// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import type * as nbformat from '@jupyterlab/nbformat';
import { assert } from 'chai';
import { Uri } from 'vscode';
import {
    cellOutputToVSCCellOutput,
    getNotebookCellOutputMetadata,
    updateNotebookMetadataWithSelectedKernel
} from './helpers';
import {
    IJupyterKernelSpec,
    LiveRemoteKernelConnectionMetadata,
    PythonKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../types';
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
        id: Uri.file('/usr/bin/python36').fsPath
    };
    const pythonDefaultKernelSpec: IJupyterKernelSpec = {
        argv: ['python', '-f', '{connection_file}'],
        display_name: 'Python Default',
        name: 'python3',
        executable: 'python'
    };
    const python37Global: PythonEnvironment = {
        uri: Uri.file('/usr/bin/python37'),
        id: Uri.file('/usr/bin/python37').fsPath
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
        const value = await updateNotebookMetadataWithSelectedKernel();
        assert.strictEqual(value.changed, false);
    });
    test('Ensure Language', async () => {
        const notebookMetadata = { orig_nbformat: 4 };
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata);

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
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

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
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

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
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

        // Verify kernel_spec name updated JUNK => python3
        verifyMetadata(notebookMetadata, {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        });
        assert.strictEqual(value.changed, true);
    });
    test('New Display Name', async () => {
        const notebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'JUNK DISPLAYNAME', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        };
        const kernelConnection = PythonKernelConnectionMetadata.create({
            id: 'python36',
            interpreter: python36Global,
            kernelSpec: pythonDefaultKernelSpec
        });
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

        // Verify kernel_spec display_name updated JUNK DISPLAYNAME => Python Default
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
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

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
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

        // Verify display_name updated due to interpreter hash change
        verifyMetadata(newNotebookMetadata, {
            orig_nbformat: 4,
            kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.6.0' }
        });

        // Should be no change here
        assert.strictEqual(value.changed, false);
    });

    test('No Change when selecting live remote kernel with matching kernelspec', async () => {
        // Regression test: selecting a live remote kernel (e.g. from jupyterServerProvider)
        // on a notebook that already has a matching kernelspec should NOT mark the notebook dirty.
        const notebookMetadata: nbformat.INotebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'My Remote Kernel', language: 'python', name: 'myremotekernel' },
            language_info: { name: 'python' }
        };
        const kernelConnection = LiveRemoteKernelConnectionMetadata.create({
            id: 'live-kernel-connection-id',
            baseUrl: 'http://localhost:8888',
            serverProviderHandle: { id: 'someProvider', handle: 'someHandle', extensionId: 'someExtension' },
            kernelModel: {
                id: 'running-kernel-uuid-1234',
                name: 'myremotekernel',
                display_name: 'My Remote Kernel',
                language: 'python',
                lastActivityTime: new Date('2024-01-01'),
                numberOfConnections: 1,
                model: undefined
            }
        });
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

        // Verify no changes since kernelspec already matches
        verifyMetadata(notebookMetadata, {
            orig_nbformat: 4,
            kernelspec: { display_name: 'My Remote Kernel', language: 'python', name: 'myremotekernel' },
            language_info: { name: 'python' }
        });
        // Should be no change here - notebook should NOT be marked dirty
        assert.strictEqual(value.changed, false);
    });

    test('No Change when language_info is null (Fabric/Synapse notebooks)', async () => {
        // Fabric/Synapse notebooks from the service have language_info: null
        // Selecting a remote kernel should NOT force-create language_info and mark dirty
        const notebookMetadata: nbformat.INotebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'PySpark', language: 'Python', name: 'synapse_pyspark' },
            language_info: null as any
        };
        const kernelConnection = RemoteKernelSpecConnectionMetadata.create({
            id: 'remote-kernelspec-id',
            baseUrl: 'http://localhost:8888',
            serverProviderHandle: { id: 'someProvider', handle: 'someHandle', extensionId: 'someExtension' },
            kernelSpec: {
                argv: [],
                display_name: 'PySpark',
                name: 'synapse_pyspark',
                executable: '',
                language: 'Python'
            }
        });
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

        // language_info should remain null — not be force-created
        assert.strictEqual(notebookMetadata.language_info, null, 'language_info should stay null');
        // kernelspec already matches, so no change
        assert.strictEqual(value.changed, false, 'should not be changed');
    });

    test('No Change when language_info is undefined', async () => {
        const notebookMetadata: nbformat.INotebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'PySpark', language: 'Python', name: 'synapse_pyspark' }
        };
        delete (notebookMetadata as any).language_info;
        const kernelConnection = RemoteKernelSpecConnectionMetadata.create({
            id: 'remote-kernelspec-id-2',
            baseUrl: 'http://localhost:8888',
            serverProviderHandle: { id: 'someProvider', handle: 'someHandle', extensionId: 'someExtension' },
            kernelSpec: {
                argv: [],
                display_name: 'PySpark',
                name: 'synapse_pyspark',
                executable: '',
                language: 'Python'
            }
        });
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

        // language_info should remain undefined
        assert.strictEqual(notebookMetadata.language_info, undefined, 'language_info should stay undefined');
        assert.strictEqual(value.changed, false, 'should not be changed');
    });

    test('No Change for startUsingRemoteKernelSpec with matching kernelspec', async () => {
        const notebookMetadata: nbformat.INotebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'PySpark', language: 'Python', name: 'synapse_pyspark' },
            language_info: { name: 'Python' }
        };
        const kernelConnection = RemoteKernelSpecConnectionMetadata.create({
            id: 'remote-kernelspec-id-3',
            baseUrl: 'http://localhost:8888',
            serverProviderHandle: { id: 'someProvider', handle: 'someHandle', extensionId: 'someExtension' },
            kernelSpec: {
                argv: [],
                display_name: 'PySpark',
                name: 'synapse_pyspark',
                executable: '',
                language: 'Python'
            }
        });
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

        verifyMetadata(notebookMetadata, {
            orig_nbformat: 4,
            kernelspec: { display_name: 'PySpark', language: 'Python', name: 'synapse_pyspark' },
            language_info: { name: 'Python' }
        });
        assert.strictEqual(value.changed, false, 'should not be changed');
    });

    test('Do not clear language_info for startUsingRemoteKernelSpec', async () => {
        const notebookMetadata: nbformat.INotebookMetadata = {
            orig_nbformat: 4,
            kernelspec: { display_name: 'PySpark', language: 'python', name: 'synapse_pyspark' },
            language_info: { name: 'python', version: '3.10.0' }
        };
        const kernelConnection = RemoteKernelSpecConnectionMetadata.create({
            id: 'remote-kernelspec-id-4',
            baseUrl: 'http://localhost:8888',
            serverProviderHandle: { id: 'someProvider', handle: 'someHandle', extensionId: 'someExtension' },
            kernelSpec: {
                argv: [],
                display_name: 'PySpark',
                name: 'synapse_pyspark',
                executable: '',
                language: 'python'
            }
        });
        const value = await updateNotebookMetadataWithSelectedKernel(notebookMetadata, kernelConnection);

        // language_info should NOT be cleared for remote kernel specs
        assert.ok(notebookMetadata.language_info, 'language_info should not be cleared');
        assert.strictEqual(notebookMetadata.language_info!.name, 'python');
        assert.strictEqual(value.changed, false, 'should not be changed');
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
