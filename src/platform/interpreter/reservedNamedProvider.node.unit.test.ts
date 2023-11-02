// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import {
    ConfigurationChangeEvent,
    ConfigurationTarget,
    EventEmitter,
    Memento,
    Uri,
    WorkspaceConfiguration
} from 'vscode';
import { IWorkspaceService } from '../common/application/types';
import { dispose } from '../common/utils/lifecycle';
import { IPlatformService } from '../common/platform/types';
import { IFileSystemNode } from '../common/platform/types.node';
import { IDisposable } from '../common/types';
import { ignoreListSettingName, ReservedNamedProvider } from './reservedNamedProvider.node';
import * as path from '../vscode-path/path';

suite('Reserved Names Provider', () => {
    let disposables: IDisposable[] = [];
    let reservedNamedProvider: ReservedNamedProvider;
    let memento: Memento;
    let workspace: IWorkspaceService;
    let platform: IPlatformService;
    let fs: IFileSystemNode;
    let workspaceConfig: WorkspaceConfiguration;
    let settingsChanged: EventEmitter<ConfigurationChangeEvent>;
    const defaultIgnoreList = ['**/site-packages/**', '**/lib/python/**', '**/lib64/python/**'];
    setup(() => {
        memento = mock<Memento>();
        workspace = mock<IWorkspaceService>();
        platform = mock<IPlatformService>();
        fs = mock<IFileSystemNode>();
        workspaceConfig = mock<WorkspaceConfiguration>();
        when(memento.update(anything(), anything())).thenResolve();
        when(workspace.getConfiguration('jupyter')).thenReturn(instance(workspaceConfig));
        when(workspaceConfig.get(ignoreListSettingName, anything())).thenReturn(defaultIgnoreList);
        when(memento.get(anything(), anything())).thenCall((_, defaultValue) => defaultValue as any);
        settingsChanged = new EventEmitter<ConfigurationChangeEvent>();
        disposables.push(settingsChanged);
        when(workspace.onDidChangeConfiguration).thenReturn(settingsChanged.event);
        createProvider();
    });
    teardown(() => {
        disposables = dispose(disposables);
    });
    function createProvider() {
        reservedNamedProvider = new ReservedNamedProvider(
            instance(memento),
            instance(workspace),
            instance(platform),
            disposables,
            instance(fs)
        );
    }
    test('Returns valid Uris of files and folders that can override builtins', async () => {
        const cwd = Uri.joinPath(Uri.file('users'), 'username', 'folder', 'projectDir');
        const cwdFiles = ['one.py', 'xml.py', 'two.py', 'urllib.py', 'random.py', 'sample.py'];
        const initFiles = [
            `xml${path.sep}__init__.py`,
            `overrideThirdPartyModule${path.sep}__init__.py`,
            `myPersonalMod${path.sep}__init__.py`
        ];
        when(fs.searchLocal('*.py', cwd.fsPath, true)).thenResolve(cwdFiles);
        when(fs.searchLocal('*/__init__.py', cwd.fsPath, true)).thenResolve(initFiles);

        // Assume that a module named `overrideThirdPartyModule` has been installed into python, then
        // python will return that as an installed item as well.
        let listPackagesCallCount = 0;

        const uris = await reservedNamedProvider.getUriOverridingReservedPythonNames(cwd);

        assert.deepEqual(
            uris.map((uri) => uri.uri.fsPath).sort(),
            ['xml.py', 'urllib.py', 'random.py', `xml${path.sep}__init__.py`]
                .map((file) => Uri.joinPath(cwd, file).fsPath)
                .sort()
        );

        // Also verify we don't call into Python API for the same Python files that we know are overriding builtins.
        const initialCallCountIntoPythonApi = listPackagesCallCount;
        when(fs.searchLocal('*.py', cwd.fsPath, true)).thenResolve(['xml.py', 'urllib.py', 'random.py']);
        when(fs.searchLocal('*/__init__.py', cwd.fsPath, true)).thenResolve([`xml${path.sep}__init__.py`]);

        const urisAgain = await reservedNamedProvider.getUriOverridingReservedPythonNames(cwd);

        assert.deepEqual(
            urisAgain.map((uri) => uri.uri.fsPath).sort(),
            ['xml.py', 'urllib.py', 'random.py', `xml${path.sep}__init__.py`]
                .map((file) => Uri.joinPath(cwd, file).fsPath)
                .sort()
        );
        // Verify there are no additional calls into this API.
        assert.strictEqual(listPackagesCallCount, initialCallCountIntoPythonApi);
    });

    async function testGlobPattern(cwd: Uri, cwdFiles: string[], globPattern: string) {
        when(workspaceConfig.get(ignoreListSettingName, anything())).thenReturn([globPattern]);
        when(fs.searchLocal('*.py', cwd.fsPath, true)).thenResolve(cwdFiles);
        when(fs.searchLocal('*/__init__.py', cwd.fsPath, true)).thenResolve([]);
        createProvider();

        const uris = await reservedNamedProvider.getUriOverridingReservedPythonNames(cwd);

        assert.strictEqual(uris.length, 0);
    }
    test('Ignore files in site-packages', async () => {
        const cwd = Uri.joinPath(
            Uri.file('users'),
            'username',
            'folder',
            'projectDir',
            '.venv',
            'site-packages',
            'thirdPartyPackage'
        );
        const cwdFiles = ['one.py', 'xml.py', 'two.py', 'os.py', 'random.py', 'sample.py'];
        await testGlobPattern(cwd, cwdFiles, '**/site-packages/**');
    });
    test('Ignore files in lib/python', async () => {
        const cwd = Uri.joinPath(
            Uri.file('users'),
            'username',
            'folder',
            'projectDir',
            '.venv',
            'lib',
            'python',
            'thirdPartyPackage'
        );
        const cwdFiles = ['one.py', 'xml.py', 'two.py', 'os.py', 'random.py', 'sample.py'];
        await testGlobPattern(cwd, cwdFiles, '**/lib/python/**');
    });
    test('Ignore files in lib64/python', async () => {
        const cwd = Uri.joinPath(
            Uri.file('users'),
            'username',
            'folder',
            'projectDir',
            '.venv',
            'lib64',
            'python',
            'thirdPartyPackage'
        );
        const cwdFiles = ['one.py', 'xml.py', 'two.py', 'os.py', 'random.py', 'sample.py'];

        await testGlobPattern(cwd, cwdFiles, '**/lib64/python/**');
    });
    test('Ignore files in custom folder (windows)', async () => {
        const cwd = Uri.joinPath(Uri.file('users'), 'username', 'folder', 'projectDir', 'thirdPartyPackage');
        const cwdFiles = ['one.py', 'xml.py', 'two.py', 'os.py', 'random.py', 'sample.py'];
        when(platform.isWindows).thenReturn(true);
        when(platform.isLinux).thenReturn(false);

        await testGlobPattern(cwd, cwdFiles, '**/projectDir/**');
    });
    test('Ignore files in custom folder (linux)', async () => {
        const cwd = Uri.joinPath(Uri.file('users'), 'username', 'folder', 'projectDir', 'thirdPartyPackage');
        const cwdFiles = ['one.py', 'xml.py', 'two.py', 'os.py', 'random.py', 'sample.py'];
        when(platform.isWindows).thenReturn(false);
        when(platform.isLinux).thenReturn(true);

        await testGlobPattern(cwd, cwdFiles, '**/projectDir/**');
    });
    test('Ignore specific files in custom folder (linux)', async () => {
        const cwd = Uri.joinPath(Uri.file('users'), 'username', 'folder', 'projectDir', 'thirdPartyPackage');
        const cwdFiles = ['__ignore_this_prefix_one.py'];
        when(platform.isWindows).thenReturn(false);
        when(platform.isLinux).thenReturn(true);

        await testGlobPattern(cwd, cwdFiles, '**/__ignore_this_prefix*.py');
    });
    test('Test ignoring and changing settings (linux)', async () => {
        let ignoreListInSettings = [...defaultIgnoreList, '**/xml.py'];
        const cwd = Uri.joinPath(Uri.file('users'), 'username', 'folder', 'projectDir', 'thirdPartyPackage');
        const cwdFiles = ['xml.py', 'random.py'];
        when(platform.isWindows).thenReturn(false);
        when(platform.isLinux).thenReturn(true);

        when(workspaceConfig.get(ignoreListSettingName, anything())).thenCall(() => ignoreListInSettings);
        when(workspaceConfig.update(ignoreListSettingName, anything(), ConfigurationTarget.Global)).thenCall(
            async (_, value) => {
                ignoreListInSettings = value;
            }
        );
        when(fs.searchLocal('*.py', cwd.fsPath, true)).thenResolve(cwdFiles);
        when(fs.searchLocal('*/__init__.py', cwd.fsPath, true)).thenResolve([]);
        createProvider();

        let uris = await reservedNamedProvider.getUriOverridingReservedPythonNames(cwd);

        assert.strictEqual(uris.length, 1);
        assert.strictEqual(uris.map((uri) => uri.uri.toString()).join(), Uri.joinPath(cwd, 'random.py').toString());

        // Now, lets change the setting to un-ignore the above file.
        ignoreListInSettings = [...defaultIgnoreList];
        settingsChanged.fire({
            affectsConfiguration: (section) => section === `jupyter.${ignoreListSettingName}`
        });

        uris = await reservedNamedProvider.getUriOverridingReservedPythonNames(cwd);

        assert.strictEqual(
            uris
                .map((uri) => uri.uri.toString())
                .sort()
                .join(),
            cwdFiles
                .map((file) => Uri.joinPath(cwd, file).toString())
                .sort()
                .join()
        );

        // If we were to add random.py to the list, then we should ignore it.
        await reservedNamedProvider.addToIgnoreList(Uri.joinPath(cwd, 'random.py'));
        uris = await reservedNamedProvider.getUriOverridingReservedPythonNames(cwd);

        assert.strictEqual(uris.map((uri) => uri.uri.toString()).join(), Uri.joinPath(cwd, 'xml.py').toString());

        // If we were to add xml.py to the list, then we should ignore it.
        await reservedNamedProvider.addToIgnoreList(Uri.joinPath(cwd, 'xml.py'));
        uris = await reservedNamedProvider.getUriOverridingReservedPythonNames(cwd);

        assert.strictEqual(uris.length, 0);
    });
});
