// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-require-imports no-var-requires
import { assert } from 'chai';
const del = require('del');
import * as fs from 'fs-extra';
import { IDisposable } from 'monaco-editor';
import * as path from 'path';
import * as sinon from 'sinon';
import { FileType, Uri } from 'vscode';
import { RemoteFileSystem } from '../../../client/remote/ui/fileSystem';
import { RemoteFileSystemFactory } from '../../../client/remote/ui/fileSystemFactory';
import { IJupyterServerConnectionService } from '../../../client/remote/ui/types';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize';
import { JupyterServer } from '../jupyterServer';
import { canRunNotebookTests, disposeAllDisposables } from '../notebook/helper';
import { allowInSecureJupyterServerConnections, removeAllJupyterServerConnections } from './helpers';

const tempFolder = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'temp', 'temp');

// tslint:disable: no-any no-invalid-this
suite('Jupyter Server - Remote File System - (remote)', () => {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let jupyterUriWithoutAuth: Uri;
    let jupyterServerConnectionService: IJupyterServerConnectionService;
    let fileSystemFactory: RemoteFileSystemFactory;
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        jupyterUriWithoutAuth = await JupyterServer.instance.startJupyterWithToken();
        sinon.restore();
        jupyterServerConnectionService = api.serviceContainer.get<IJupyterServerConnectionService>(
            IJupyterServerConnectionService
        );
        fileSystemFactory = api.serviceContainer.get<RemoteFileSystemFactory>(RemoteFileSystemFactory);
    });
    setup(async () => {
        await Promise.all([
            del(tempFolder).finally(() => fs.ensureDir(path.join(tempFolder))),
            removeAllJupyterServerConnections(),
            allowInSecureJupyterServerConnections(true)
        ]);
    });
    teardown(async () => {
        await removeAllJupyterServerConnections();
        disposeAllDisposables(disposables);
    });
    test('FileSystem works as expected (create, list files, folders)', async () => {
        const fsDispose = sinon.spy(RemoteFileSystem.prototype, 'dispose');
        disposables.push({ dispose: () => fsDispose.restore() });
        await jupyterServerConnectionService.addServer(jupyterUriWithoutAuth);

        const connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 1);
        const connection = connections[0];
        const fileSystem = await fileSystemFactory.getOrCreateRemoteFileSystem(connection);

        assert.isOk(fileSystem);

        let items = await fileSystem.readDirectory(Uri.parse(`${connection.fileScheme}:/remote/testFiles`));
        assert.ok(items.length >= 3);
        assert.ok(items.some(([file, type]) => file === 'one.txt' && type === FileType.File));
        assert.ok(items.some(([file, type]) => file === 'two.py' && type === FileType.File));
        assert.ok(items.some(([file, type]) => file === 'three.ipynb' && type === FileType.File));

        // Test contents of a file.
        const fileBuffer = await fileSystem.readFile(Uri.parse(`${connection.fileScheme}:/remote/testFiles/one.txt`));
        assert.include(Buffer.from(fileBuffer).toString('utf8'), 'Hello World');

        // Create files & folders
        items = await fileSystem.readDirectory(Uri.parse(`${connection.fileScheme}:/temp/temp`));
        assert.equal(items.length, 0);
        await fileSystem.createNew(Uri.parse(`${connection.fileScheme}:/temp/temp`), 'notebook');
        await fileSystem.createNew(Uri.parse(`${connection.fileScheme}:/temp/temp`), 'directory');

        // Verify untitled file.
        items = await fileSystem.readDirectory(Uri.parse(`${connection.fileScheme}:/temp/temp`));
        assert.equal(items.length, 2);
        assert.ok(items.some(([, type]) => type === FileType.File));
        assert.ok(items.some(([, type]) => type === FileType.Directory));
        const newNotebookFileName = items.find(([, type]) => type === FileType.File)![0];
        assert.include(newNotebookFileName.toLowerCase(), 'untitled');

        assert.ok(fs.existsSync(path.join(tempFolder, newNotebookFileName)));

        // Verify deletion.
        await fileSystem.delete(Uri.parse(`${connection.fileScheme}:/temp/temp/${newNotebookFileName}`));
        assert.isFalse(fs.existsSync(path.join(tempFolder, newNotebookFileName)));
    });
    test('Can get a FileSystem and it will be disposed when disconnecting server', async () => {
        const fsDispose = sinon.spy(RemoteFileSystem.prototype, 'dispose');
        disposables.push({ dispose: () => fsDispose.restore() });
        await jupyterServerConnectionService.addServer(jupyterUriWithoutAuth);

        const connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 1);
        const fileSystem = await fileSystemFactory.getOrCreateRemoteFileSystem(connections[0]);

        assert.isOk(fileSystem);

        // Disconnecting from server will dispose the filesystem.
        jupyterServerConnectionService.disconnect(connections[0].id);
        await waitForCondition(async () => fsDispose.calledOnce, 500, 'FileSystem not disposed');
    });
});
