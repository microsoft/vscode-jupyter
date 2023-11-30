// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { ConfigurationTarget, Memento, Uri, workspace } from 'vscode';
import { IMemento, GLOBAL_MEMENTO, IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { BuiltInModules } from './constants';
import { IPlatformService } from '../../platform/common/platform/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { IReservedPythonNamedProvider } from './types';
import minimatch from 'minimatch';
import { IFileSystemNode } from '../common/platform/types.node';
import * as path from '../../platform/vscode-path/resources';

const PYTHON_PACKAGES_MEMENTO_KEY = 'jupyter.pythonPackages';
export const ignoreListSettingName = 'diagnostics.reservedPythonNames.exclude';
/**
 * Determines if a file or directory in the workspace is overriding a reserved python name.
 */
@injectable()
export class ReservedNamedProvider implements IReservedPythonNamedProvider {
    private ignoredFiles = new Set<string>();
    private readonly cachedModules = new Set<string>();
    private pendingUpdate = Promise.resolve();
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private cache: Memento,
        @inject(IPlatformService) private platform: IPlatformService,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode
    ) {
        disposables.push(this);
        this.cachedModules = new Set(
            this.cache.get<string[]>(PYTHON_PACKAGES_MEMENTO_KEY, BuiltInModules).map((item) => item.toLowerCase())
        );
        workspace.onDidChangeConfiguration(
            (e) => {
                if (e.affectsConfiguration(`jupyter.${ignoreListSettingName}`)) {
                    this.initializeIgnoreList();
                }
            },
            this,
            this.disposables
        );
        this.initializeIgnoreList();
    }

    public dispose() {
        dispose(this.disposables);
    }

    public async getUriOverridingReservedPythonNames(cwd: Uri): Promise<{ uri: Uri; type: 'file' | '__init__' }[]> {
        const [files, initFile] = await Promise.all([
            this.fs.searchLocal('*.py', cwd.fsPath, true),
            // Look for packages in the current directory (only interested in top level).
            // Just as xml.py could end up overriding the built in xml module, so can xml/__init__.py.
            this.fs.searchLocal('*/__init__.py', cwd.fsPath, true)
        ]);
        const problematicFiles: { uri: Uri; type: 'file' | '__init__' }[] = [];
        const filePromises = Promise.all(
            files
                .map((file) => Uri.joinPath(cwd, file))
                .map(async (uri) => {
                    if (await this.isReserved(uri)) {
                        problematicFiles.push({ uri, type: 'file' });
                    }
                })
        );
        const initFilePromises = Promise.all(
            initFile
                .map((file) => Uri.joinPath(cwd, file))
                .map(async (uri) => {
                    if (await this.isReserved(uri)) {
                        problematicFiles.push({ uri, type: '__init__' });
                    }
                })
        );
        await Promise.all([filePromises, initFilePromises]);
        return problematicFiles;
    }
    public async isReserved(uri: Uri): Promise<boolean> {
        // Lets keep it simple and focus only on plain text python files.
        if (!uri.fsPath.toLowerCase().endsWith('.py')) {
            return false;
        }

        await this.pendingUpdate;
        const filePath = this.platform.isWindows ? uri.fsPath.toLowerCase() : uri.fsPath;
        if (
            Array.from(this.ignoredFiles).some((item) => {
                if (item === filePath || minimatch(filePath, item, { dot: true })) {
                    return true;
                }
            })
        ) {
            return false;
        }

        // Use the name of the file as the module name.
        const baseName = path.basename(uri, path.extname(uri)).toLowerCase();
        // If its a __init__.py, get name of parent folder (as its a module).
        const possibleModule = baseName === '__init__' ? path.basename(path.dirname(uri)).toLowerCase() : baseName;
        return this.cachedModules.has(possibleModule);
    }
    public async addToIgnoreList(uri: Uri) {
        await this.pendingUpdate;
        const jupyterConfig = workspace.getConfiguration('jupyter');
        const filePath = this.platform.isWindows ? uri.fsPath.toLowerCase() : uri.fsPath;
        this.initializeIgnoreList();
        const originalSizeOfList = this.ignoredFiles.size;
        this.ignoredFiles.add(filePath);
        if (originalSizeOfList === this.ignoredFiles.size) {
            return;
        }
        this.pendingUpdate = this.pendingUpdate.finally(() =>
            jupyterConfig.update(ignoreListSettingName, Array.from(this.ignoredFiles), ConfigurationTarget.Global)
        );
        return this.pendingUpdate;
    }
    private initializeIgnoreList() {
        const jupyterConfig = workspace.getConfiguration('jupyter');
        let listInSettings = jupyterConfig.get(ignoreListSettingName, []) as string[];
        // Ignore file case on windows, hence lower case the files.
        if (this.platform.isWindows) {
            listInSettings = listInSettings.map((item) => item.toLowerCase());
        }
        this.ignoredFiles = new Set(listInSettings);
    }
}
