// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { LocalKernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../../kernels/types';
import { IWorkspaceService } from '../../platform/common/application/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { IExtensionContext } from '../../platform/common/types';
import { TestNotebookDocument } from '../../test/datascience/notebook/executionHelper';
import { ConnectionMru } from './connectionMru.node';
import { IKernelRankingHelper } from './types';

suite('Connection MRU (node)', () => {
    let mru: ConnectionMru;
    let rankingHelper: IKernelRankingHelper;
    let context: IExtensionContext;
    let fs: IFileSystem;
    let workspace: IWorkspaceService;
    const javaKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'java',
        kernelSpec: {
            argv: ['java'],
            display_name: 'java',
            executable: 'java',
            name: 'java',
            language: 'java'
        }
    });
    const pythonKernelSpec = PythonKernelConnectionMetadata.create({
        id: 'python',
        interpreter: {
            id: 'python',
            sysPrefix: '',
            uri: Uri.file('python')
        },
        kernelSpec: {
            argv: ['python'],
            display_name: 'python',
            executable: 'python',
            name: 'python'
        }
    });
    const notebook = new TestNotebookDocument(Uri.file('notebook1.ipynb'));
    setup(() => {
        rankingHelper = mock<IKernelRankingHelper>();
        context = mock<IExtensionContext>();
        fs = mock<IFileSystem>();
        workspace = mock<IWorkspaceService>();
        when(fs.exists(anything())).thenResolve(false);
        when(fs.createDirectory(anything())).thenResolve();
        when(context.storageUri).thenReturn(Uri.file('workspaceStorage'));
        when(workspace.getWorkspaceFolderIdentifier(anything())).thenReturn('workspace1');
        when(workspace.getWorkspaceFolderIdentifier(anything(), anything())).thenReturn('workspace1');
        when(fs.readFile(anything())).thenReject(new Error('File not found'));
        when(rankingHelper.isExactMatch(anything(), anything(), anything())).thenResolve(false);
        mru = new ConnectionMru(instance(rankingHelper), instance(context), instance(fs), instance(workspace));
    });

    test('No MRU items for first time users', async () => {
        const exists = await mru.exists(notebook, pythonKernelSpec);

        assert.isFalse(exists);
    });
    test('Update MRU', async () => {
        await mru.add(notebook, pythonKernelSpec);
        const exists = await mru.exists(notebook, pythonKernelSpec);

        assert.isTrue(exists);
    });
    test('Update file when updating MRU', async () => {
        when(fs.exists(anything())).thenResolve(true);
        assert.isFalse(await mru.exists(notebook, pythonKernelSpec));
        assert.isFalse(await mru.exists(notebook, javaKernelSpec));

        await mru.add(notebook, pythonKernelSpec);

        assert.isTrue(await mru.exists(notebook, pythonKernelSpec));
        assert.isFalse(await mru.exists(notebook, javaKernelSpec));
        verify(fs.writeFile(anything(), anything())).atLeast(1);
        let json = JSON.parse(capture(fs.writeFile).first()[1] as string) as [number, string][];
        assert.strictEqual(json[0][1], await pythonKernelSpec.getHashId());

        await mru.add(notebook, javaKernelSpec);

        assert.isTrue(await mru.exists(notebook, pythonKernelSpec));
        assert.isTrue(await mru.exists(notebook, javaKernelSpec));
        json = JSON.parse(capture(fs.writeFile).second()[1] as string) as [number, string][];
        assert.strictEqual(json[0][1], await pythonKernelSpec.getHashId());
        assert.strictEqual(json[1][1], await javaKernelSpec.getHashId());
    });
    test('Load MRU from file', async () => {
        when(fs.exists(anything())).thenResolve(true);
        when(fs.readFile(anything())).thenResolve(JSON.stringify([[1, await pythonKernelSpec.getHashId()]]));
        assert.isTrue(await mru.exists(notebook, pythonKernelSpec));
        assert.isFalse(await mru.exists(notebook, javaKernelSpec));
    });
    test('Load MRU from file (with more than one item)', async () => {
        when(fs.exists(anything())).thenResolve(true);
        when(fs.readFile(anything())).thenResolve(
            JSON.stringify([
                [1, await pythonKernelSpec.getHashId()],
                [2, await javaKernelSpec.getHashId()]
            ])
        );
        assert.isTrue(await mru.exists(notebook, pythonKernelSpec));
        assert.isTrue(await mru.exists(notebook, javaKernelSpec));
    });
    test('Update existing MRUs', async () => {
        when(fs.exists(anything())).thenResolve(true);
        when(fs.readFile(anything())).thenResolve(
            JSON.stringify([
                [1, await pythonKernelSpec.getHashId()],
                [2, await javaKernelSpec.getHashId()]
            ])
        );
        assert.isTrue(await mru.exists(notebook, pythonKernelSpec));
        assert.isTrue(await mru.exists(notebook, javaKernelSpec));

        await mru.add(notebook, pythonKernelSpec);

        verify(fs.writeFile(anything(), anything())).atLeast(1);
        let json = JSON.parse(capture(fs.writeFile).first()[1] as string) as [number, string][];
        assert.strictEqual(json[0][1], await pythonKernelSpec.getHashId());
        assert.isAtLeast(json[0][0], Date.now() - 60 * 1000);
        assert.strictEqual(json[1][0], 2);

        await mru.add(notebook, javaKernelSpec);

        json = JSON.parse(capture(fs.writeFile).second()[1] as string) as [number, string][];
        assert.strictEqual(json[0][1], await pythonKernelSpec.getHashId());
        assert.strictEqual(json[1][1], await javaKernelSpec.getHashId());
        assert.isAtLeast(json[1][0], Date.now() - 60 * 1000);
    });
    test('Use different MRUs per notebook document', async () => {
        when(fs.exists(anything())).thenResolve(true);
        const notebook2 = new TestNotebookDocument(Uri.file('notebook2.ipynb'));

        assert.isFalse(await mru.exists(notebook, pythonKernelSpec));
        assert.isFalse(await mru.exists(notebook, javaKernelSpec));
        assert.isFalse(await mru.exists(notebook2, pythonKernelSpec));
        assert.isFalse(await mru.exists(notebook2, javaKernelSpec));

        await mru.add(notebook, pythonKernelSpec);

        assert.isTrue(await mru.exists(notebook, pythonKernelSpec));
        assert.isFalse(await mru.exists(notebook, javaKernelSpec));
        assert.isFalse(await mru.exists(notebook2, pythonKernelSpec));
        assert.isFalse(await mru.exists(notebook2, javaKernelSpec));

        await mru.add(notebook2, javaKernelSpec);

        assert.isTrue(await mru.exists(notebook, pythonKernelSpec));
        assert.isFalse(await mru.exists(notebook, javaKernelSpec));
        assert.isFalse(await mru.exists(notebook2, pythonKernelSpec));
        assert.isTrue(await mru.exists(notebook2, javaKernelSpec));

        await Promise.all([mru.add(notebook, javaKernelSpec), mru.add(notebook2, pythonKernelSpec)]);

        assert.isTrue(await mru.exists(notebook, pythonKernelSpec));
        assert.isTrue(await mru.exists(notebook, javaKernelSpec));
        assert.isTrue(await mru.exists(notebook2, pythonKernelSpec));
        assert.isTrue(await mru.exists(notebook2, javaKernelSpec));
    });
});
