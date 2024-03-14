// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { SemVer } from 'semver';
import { Memento, Uri } from 'vscode';
import { IPythonApiProvider } from '../api/types';
import { traceVerbose } from '../logging';
import { IFileSystem } from '../common/platform/types';
import { GLOBAL_MEMENTO, IMemento } from '../common/types';
import { createDeferredFromPromise } from '../common/utils/async';
import * as path from '../vscode-path/path';
import { noop } from '../common/utils/misc';

const CACHEKEY_FOR_CONDA_INFO = 'CONDA_INFORMATION_CACHE';

/**
 * When returning the file path to conda we sometimes end up with `/conda`,
 * & that cannot be executed as is, instead it needs to be executed as `conda`.
 */
function getFullFilePath(file?: Uri) {
    if (
        file &&
        path.isAbsolute(file.fsPath) &&
        file.fsPath.startsWith(path.sep) &&
        `${path.sep}${path.basename(file.fsPath)}` === file.fsPath
    ) {
        return path.basename(file.fsPath);
    }
    return file?.fsPath;
}
/**
 * Provides utilties to query information about conda that's installed on the same machine as the extension. (Note: doesn't work over remote)
 */
@injectable()
export class CondaService {
    private isAvailable: boolean | undefined;
    private _file?: Uri;
    private _version?: SemVer;
    private _previousVersionCall?: Promise<SemVer | undefined>;
    private _previousFileCall?: Promise<Uri | undefined>;
    constructor(
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}

    async getCondaVersion() {
        if (this._version) {
            return this._version;
        }
        if (this._previousVersionCall) {
            return this._previousVersionCall;
        }
        const promise = async () => {
            const latestInfo = this.getCondaVersionFromPython();
            latestInfo
                .then((version) => {
                    this._version = version;
                    this.updateCache().catch(noop);
                })
                .catch(noop);
            const cachedInfo = createDeferredFromPromise(this.getCachedInformation());
            await Promise.race([cachedInfo.promise, latestInfo]);
            if (cachedInfo.completed && cachedInfo.value?.version) {
                return (this._version = cachedInfo.value.version);
            }
            return latestInfo;
        };
        this._previousVersionCall = promise();
        return this._previousVersionCall;
    }
    async getCondaFile() {
        if (this._file) {
            return getFullFilePath(this._file);
        }
        if (this._previousFileCall) {
            return this._previousFileCall.then(getFullFilePath);
        }
        const promise = async () => {
            const latestInfo = this.pythonApi
                .getApi()
                .then((api) => (api.getCondaFile ? api.getCondaFile() : undefined));
            latestInfo
                .then((file) => {
                    traceVerbose(`Conda file is ${file}`);
                    this._file = file ? Uri.file(file) : undefined;
                    this.updateCache().catch(noop);
                })
                .catch(noop);
            const cachedInfo = createDeferredFromPromise(this.getCachedInformation());
            await Promise.race([cachedInfo.promise, latestInfo]);
            if (cachedInfo.completed && cachedInfo.value?.file) {
                return (this._file = cachedInfo.value.file);
            }
            return latestInfo.then((v) => (v ? Uri.file(v) : undefined));
        };
        this._previousFileCall = promise();
        return this._previousFileCall.then(getFullFilePath);
    }

    /**
     * Is there a conda install to use?
     */
    public async isCondaAvailable(): Promise<boolean> {
        if (typeof this.isAvailable === 'boolean') {
            return this.isAvailable;
        }
        return this.getCondaVersion()

            .then((version) => (this.isAvailable = version !== undefined)) // eslint-disable-line no-return-assign
            .catch(() => (this.isAvailable = false)); // eslint-disable-line no-return-assign
    }
    private async updateCache() {
        if (!this._file || !this._version) {
            return;
        }
        const fileHash = this._file.fsPath.toLowerCase().endsWith('conda') ? '' : await this.fs.getFileHash(this._file);
        await this.globalState.update(CACHEKEY_FOR_CONDA_INFO, {
            version: this._version.raw,
            file: this._file.fsPath,
            fileHash
        });
    }
    /**
     * If the last modified date of the conda file is the same as when we last checked,
     * then we can assume the version is the same.
     * Even if not, we'll update this with the latest information.
     */
    private async getCachedInformation(): Promise<{ version: SemVer; file: Uri } | undefined> {
        const cachedInfo = this.globalState.get<{ version: string; file: string; fileHash: string } | undefined>(
            CACHEKEY_FOR_CONDA_INFO,
            undefined
        );
        if (!cachedInfo) {
            return;
        }
        const fileHash = cachedInfo.file.toLowerCase().endsWith('conda')
            ? ''
            : await this.fs.getFileHash(Uri.file(cachedInfo.file));
        if (cachedInfo.fileHash === fileHash) {
            return {
                version: new SemVer(cachedInfo.version),
                file: Uri.file(cachedInfo.file)
            };
        }
    }
    private async getCondaVersionFromPython(): Promise<SemVer | undefined> {
        return this.pythonApi.getApi().then((api) => (api.getCondaVersion ? api.getCondaVersion() : undefined));
    }
}
