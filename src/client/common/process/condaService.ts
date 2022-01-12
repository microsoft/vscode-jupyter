// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { SemVer } from 'semver';
import { Memento } from 'vscode';
import { IPythonApiProvider } from '../../api/types';
import { TraceOptions } from '../../logging/trace';
import { traceDecorators } from '../logger';
import { IFileSystem } from '../platform/types';
import { GLOBAL_MEMENTO, IMemento } from '../types';
import { createDeferredFromPromise } from '../utils/async';

const CACHEKEY_FOR_CONDA_INFO = 'CONDA_INFORMATION_CACHE';

@injectable()
export class CondaService {
    private _file?: string;
    private _version?: SemVer;
    private _previousVersionCall?: Promise<SemVer | undefined>;
    private _previousFileCall?: Promise<string | undefined>;
    constructor(
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}
    @traceDecorators.verbose('getCondaVersion', TraceOptions.BeforeCall)
    async getCondaVersion() {
        if (this._version) {
            return this._version;
        }
        if (this._previousVersionCall) {
            return this._previousVersionCall;
        }
        const promise = async () => {
            const latestInfo = this.getCondaVersionFromPython();
            void latestInfo.then((version) => {
                this._version = version;
                void this.updateCache();
            });
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
    @traceDecorators.verbose('getCondaFile', TraceOptions.BeforeCall)
    async getCondaFile() {
        if (this._file) {
            return this._file;
        }
        if (this._previousFileCall) {
            return this._previousFileCall;
        }
        const promise = async () => {
            const latestInfo = this.pythonApi
                .getApi()
                .then((api) => (api.getCondaFile ? api.getCondaFile() : undefined));
            void latestInfo.then((file) => {
                this._file = file;
                void this.updateCache();
            });
            const cachedInfo = createDeferredFromPromise(this.getCachedInformation());
            await Promise.race([cachedInfo.promise, latestInfo]);
            if (cachedInfo.completed && cachedInfo.value?.file) {
                return (this._file = cachedInfo.value.file);
            }
            return latestInfo;
        };
        this._previousFileCall = promise();
        return this._previousFileCall;
    }
    private async updateCache() {
        if (!this._file || !this._version) {
            return;
        }
        const fileHash = this._file.toLowerCase() === 'conda' ? '' : await this.fs.getFileHash(this._file);
        await this.globalState.update(CACHEKEY_FOR_CONDA_INFO, {
            version: this._version.raw,
            file: this._file,
            fileHash
        });
    }
    /**
     * If the last modified date of the conda file is the same as when we last checked,
     * then we can assume the version is the same.
     * Even if not, we'll update this with the latest information.
     */
    private async getCachedInformation(): Promise<{ version: SemVer; file: string } | undefined> {
        const cachedInfo = this.globalState.get<{ version: string; file: string; fileHash: string } | undefined>(
            CACHEKEY_FOR_CONDA_INFO,
            undefined
        );
        if (!cachedInfo) {
            return;
        }
        const fileHash = cachedInfo.file.toLowerCase() === 'conda' ? '' : await this.fs.getFileHash(cachedInfo.file);
        if (cachedInfo.fileHash === fileHash) {
            return {
                version: new SemVer(cachedInfo.version),
                file: cachedInfo.file
            };
        }
    }
    @traceDecorators.verbose('getCondaVersionFromPython', TraceOptions.BeforeCall)
    private async getCondaVersionFromPython(): Promise<SemVer | undefined> {
        return this.pythonApi.getApi().then((api) => (api.getCondaVersion ? api.getCondaVersion() : undefined));
    }
}
