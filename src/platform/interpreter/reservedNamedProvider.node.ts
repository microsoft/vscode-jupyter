// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { ConfigurationTarget, Memento, Uri } from 'vscode';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IMemento, GLOBAL_MEMENTO, IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { BuiltInModules } from './constants';
import { noop } from '../../platform/common/utils/misc';
import { IWorkspaceService } from '../../platform/common/application/types';
import { IPlatformService } from '../../platform/common/platform/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IReservedPythonNamedProvider } from './types';
import { IInterpreterPackages } from '../../telemetry';
import * as minimatch from 'minimatch';
import { IFileSystemNode } from '../common/platform/types.node';
import * as path from '../../platform/vscode-path/resources';

const PYTHON_PACKAGES_MEMENTO_KEY = 'jupyter.pythonPackages';
const ignoreListSettingName = 'diagnostics.reservedPythonNames.exclude';
@injectable()
export class ReservedNamedProvider implements IReservedPythonNamedProvider {
    private ignoredFiles = new Set<string>();
    private readonly cachedModules = new Set<string>();
    private pendingUpdate = Promise.resolve();
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IInterpreterPackages) private readonly packages: IInterpreterPackages,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private cache: Memento,
        @inject(IWorkspaceService) private workspace: IWorkspaceService,
        @inject(IPlatformService) private platform: IPlatformService,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode
    ) {
        disposables.push(this);
        this.cachedModules = new Set(
            this.cache.get<string[]>(PYTHON_PACKAGES_MEMENTO_KEY, BuiltInModules).map((item) => item.toLowerCase())
        );

        this.initializeIgnoreList();
    }

    public dispose() {
        disposeAllDisposables(this.disposables);
    }

    public async getFilesOverridingReservedPythonNames(cwd: Uri): Promise<Uri[]> {
        const files = await this.fs.searchLocal('*.py', cwd.fsPath, true);
        const problematicFiles: Uri[] = [];
        await Promise.all(
            files.map(async (file) => {
                const uri = Uri.file(file);
                if (await this.isReserved(uri)) {
                    // eslint-disable-next-line local-rules/dont-use-fspath
                    problematicFiles.push(Uri.joinPath(cwd, uri.fsPath));
                }
            })
        );
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
            Array.from(this.ignoredFiles).some(
                (item) => item === filePath || minimatch(uri.fsPath, item, { dot: true })
            )
        ) {
            return false;
        }

        // Use the name of the file as the module name.
        const possibleModule = path.basename(uri, path.extname(uri)).toLowerCase();
        if (this.cachedModules.has(possibleModule)) {
            return true;
        }

        if (this.extensionChecker.isPythonExtensionInstalled) {
            const packages = await this.packages.listPackages(uri);
            const previousCount = this.cachedModules.size;
            packages.forEach((item) => this.cachedModules.add(item));
            if (previousCount < this.cachedModules.size) {
                this.cache.update(PYTHON_PACKAGES_MEMENTO_KEY, Array.from(this.cachedModules)).then(noop, noop);
            }
            return packages.has(possibleModule);
        } else {
            return false;
        }
    }
    public async addToIgnoreList(uri: Uri) {
        await this.updateIgnoreList(uri, 'add');
    }
    private async updateIgnoreList(uri: Uri, operation: 'add' | 'remove') {
        await this.pendingUpdate;
        const jupyterConfig = this.workspace.getConfiguration('jupyter');
        const filePath = this.platform.isWindows ? uri.fsPath.toLowerCase() : uri.fsPath;
        this.initializeIgnoreList();
        if (this.ignoredFiles.size === 0 && operation === 'remove') {
            return;
        }
        const originalSizeOfList = this.ignoredFiles.size;
        if (operation === 'add') {
            this.ignoredFiles.add(filePath);
        } else {
            this.ignoredFiles.delete(filePath);
        }
        if (originalSizeOfList === this.ignoredFiles.size) {
            return;
        }
        this.pendingUpdate = this.pendingUpdate.finally(() =>
            jupyterConfig.update(ignoreListSettingName, Array.from(this.ignoredFiles), ConfigurationTarget.Global)
        );
        return this.pendingUpdate;
    }
    private initializeIgnoreList() {
        const jupyterConfig = this.workspace.getConfiguration('jupyter');
        let listInSettings = jupyterConfig.get(ignoreListSettingName, []) as string[];
        // Ignore file case on windows, hence lower case the files.
        if (this.platform.isWindows) {
            listInSettings = listInSettings.map((item) => item.toLowerCase());
        }
        this.ignoredFiles = new Set(listInSettings);
    }
}
