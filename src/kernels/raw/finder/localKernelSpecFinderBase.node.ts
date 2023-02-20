// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../../platform/vscode-path/path';
import * as uriPath from '../../../platform/vscode-path/resources';
import { CancellationToken, Event, EventEmitter, Memento, Uri } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationEnvironment, IWorkspaceService } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceVerbose, traceError } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IDisposable, IDisposableRegistry, ReadWrite } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { getInterpreterKernelSpecName, getKernelRegistrationInfo } from '../../../kernels/helpers';
import {
    BaseKernelConnectionMetadata,
    IJupyterKernelSpec,
    LocalKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { JupyterKernelSpec } from '../../jupyter/jupyterKernelSpec';
import { getComparisonKey } from '../../../platform/vscode-path/resources';
import { removeOldCachedItems } from '../../common/commonFinder';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { JupyterPaths } from './jupyterPaths.node';

export type KernelSpecFileWithContainingInterpreter = { interpreter?: PythonEnvironment; kernelSpecFile: Uri };
export const isDefaultPythonKernelSpecSpecName = /python\s\d*.?\d*$/;
export const oldKernelsSpecFolderName = '__old_vscode_kernelspecs';

/**
 * Base class for searching for local kernels that are based on a kernel spec file.
 */
export class LocalKernelSpecFinder implements IDisposable {
    private _oldKernelSpecsFolder?: string;
    private findKernelSpecsInPathCache = new Map<string, Promise<Uri[]>>();

    public get oldKernelSpecsFolder() {
        return this._oldKernelSpecsFolder || this.globalState.get<string>('OLD_KERNEL_SPECS_FOLDER__', '');
    }
    private set oldKernelSpecsFolder(value: string) {
        this._oldKernelSpecsFolder = value;
        this.globalState.update('OLD_KERNEL_SPECS_FOLDER__', value).then(noop, noop);
    }
    private cache?: KernelSpecFileWithContainingInterpreter[];
    // Store any json file that we have loaded from disk before
    private pathToKernelSpec = new Map<string, Promise<IJupyterKernelSpec | undefined>>();
    private readonly disposables: IDisposable[] = [];
    constructor(
        private readonly fs: IFileSystemNode,
        private readonly globalState: Memento,
        private readonly jupyterPaths: JupyterPaths
    ) {
        if (this.oldKernelSpecsFolder) {
            traceVerbose(
                `Old kernelSpecs (created by Jupyter Extension) stored in directory ${this.oldKernelSpecsFolder}`
            );
        }
    }
    public clearCache() {
        this.pathToKernelSpec.clear();
        this.findKernelSpecsInPathCache.clear();
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    /**
     * Load the IJupyterKernelSpec for a given spec path, check the ones that we have already loaded first
     */
    public async loadKernelSpec(
        specPath: Uri,
        cancelToken: CancellationToken,
        interpreter?: PythonEnvironment
    ): Promise<IJupyterKernelSpec | undefined> {
        // This is a backup folder for old kernels created by us.
        if (specPath.fsPath.includes(oldKernelsSpecFolderName)) {
            return;
        }
        const key = getComparisonKey(specPath);
        // If we have not already loaded this kernel spec, then load it
        if (!this.pathToKernelSpec.has(key)) {
            const promise = this.loadKernelSpecImpl(specPath, cancelToken, interpreter).then(async (kernelSpec) => {
                const globalSpecRootPath = await this.jupyterPaths.getKernelSpecRootPath();
                // Delete old kernelSpecs that we created in the global kernelSpecs folder.
                const shouldDeleteKernelSpec =
                    kernelSpec &&
                    globalSpecRootPath &&
                    getKernelRegistrationInfo(kernelSpec) &&
                    kernelSpec.specFile &&
                    uriPath.isEqualOrParent(Uri.file(kernelSpec.specFile), globalSpecRootPath);
                if (kernelSpec && !shouldDeleteKernelSpec) {
                    return kernelSpec;
                }
                if (kernelSpec?.specFile && shouldDeleteKernelSpec) {
                    // If this kernelSpec was registered by us and is in the global kernels folder,
                    // then remove it.
                    this.deleteOldKernelSpec(kernelSpec.specFile).catch(noop);
                }

                // If we failed to get a kernelSpec full path from our cache and loaded list
                if (this.pathToKernelSpec.get(key) === promise) {
                    this.pathToKernelSpec.delete(key);
                }
                this.cache = this.cache?.filter((itemPath) => uriPath.isEqual(itemPath.kernelSpecFile, specPath));
                return undefined;
            });
            this.pathToKernelSpec.set(key, promise);
            promise.finally(() => {
                if (cancelToken.isCancellationRequested && this.pathToKernelSpec.get(key) === promise) {
                    this.pathToKernelSpec.delete(key);
                }
            });
        }
        // ! as the has and set above verify that we have a return here
        return this.pathToKernelSpec.get(key)!;
    }

    private async deleteOldKernelSpec(kernelSpecFile: string) {
        // Just copy this folder into a seprate location.
        const kernelSpecFolderName = path.basename(path.dirname(kernelSpecFile));
        const destinationFolder = path.join(path.dirname(path.dirname(kernelSpecFile)), oldKernelsSpecFolderName);
        this.oldKernelSpecsFolder = destinationFolder;
        const destinationFile = path.join(destinationFolder, kernelSpecFolderName, path.basename(kernelSpecFile));
        await this.fs.createDirectory(Uri.file(path.dirname(destinationFile)));
        await this.fs.copy(Uri.file(kernelSpecFile), Uri.file(destinationFile)).catch(noop);
        await this.fs.delete(Uri.file(kernelSpecFile));
        traceVerbose(`Old KernelSpec '${kernelSpecFile}' deleted and backup stored in ${destinationFolder}`);
    }
    /**
     * Load kernelspec json from disk
     */
    private async loadKernelSpecImpl(
        specPath: Uri,
        cancelToken: CancellationToken,
        interpreter?: PythonEnvironment
    ): Promise<IJupyterKernelSpec | undefined> {
        return loadKernelSpec(specPath, this.fs, cancelToken, interpreter);
    }
    // Given a set of paths, search for kernel.json files and return back the full paths of all of them that we find
    public async findKernelSpecsInPaths(kernelSearchPath: Uri, cancelToken: CancellationToken): Promise<Uri[]> {
        const cacheKey = getComparisonKey(kernelSearchPath);

        const previousPromise = this.findKernelSpecsInPathCache.get(cacheKey);
        if (previousPromise) {
            return previousPromise;
        }
        const promise = (async () => {
            if (await this.fs.exists(kernelSearchPath)) {
                if (cancelToken.isCancellationRequested) {
                    return [];
                }
                const files = await this.fs.searchLocal(`**/kernel.json`, kernelSearchPath.fsPath, true);
                return files.map((item) => uriPath.joinPath(kernelSearchPath, item));
            } else {
                traceVerbose(`Not Searching for kernels as path does not exist, ${getDisplayPath(kernelSearchPath)}`);
                return [];
            }
        })();
        this.findKernelSpecsInPathCache.set(cacheKey, promise);
        const disposable = cancelToken.onCancellationRequested(() => {
            if (this.findKernelSpecsInPathCache.get(cacheKey) === promise) {
                this.findKernelSpecsInPathCache.delete(cacheKey);
            }
        });
        promise.finally(() => {
            if (cancelToken.isCancellationRequested && this.findKernelSpecsInPathCache.get(cacheKey) === promise) {
                this.findKernelSpecsInPathCache.delete(cacheKey);
            }
            disposable.dispose();
        });
        promise.catch((ex) => {
            if (this.findKernelSpecsInPathCache.get(cacheKey) === promise) {
                this.findKernelSpecsInPathCache.delete(cacheKey);
            }
            traceVerbose(`Failed to search for kernels in ${getDisplayPath(kernelSearchPath)} with an error`, ex);
        });
        return promise;
    }
}
export interface ILocalKernelFinder<T extends LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata> {
    readonly status: 'discovering' | 'idle';
    onDidChangeStatus: Event<void>;
    onDidChangeKernels: Event<void>;
    refresh(): Promise<void>;
    readonly kernels: T[];
}
/**
 * Base class for searching for local kernels that are based on a kernel spec file.
 */
export abstract class LocalKernelSpecFinderBase<
    T extends LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata
> implements IDisposable, ILocalKernelFinder<T>
{
    protected readonly disposables: IDisposable[] = [];

    private _status: 'discovering' | 'idle' = 'idle';
    public get status() {
        return this._status;
    }
    private set status(value: typeof this._status) {
        if (this._status === value) {
            return;
        }
        this._status = value;
        this._onDidChangeStatus.fire();
    }
    protected readonly promiseMonitor = new PromiseMonitor();
    private readonly _onDidChangeStatus = new EventEmitter<void>();
    public readonly onDidChangeStatus = this._onDidChangeStatus.event;
    protected readonly _onDidChangeKernels = new EventEmitter<void>();
    public readonly onDidChangeKernels = this._onDidChangeKernels.event;
    protected readonly kernelSpecFinder: LocalKernelSpecFinder;
    constructor(
        protected readonly fs: IFileSystemNode,
        protected readonly workspaceService: IWorkspaceService,
        protected readonly extensionChecker: IPythonExtensionChecker,
        protected readonly memento: Memento,
        disposables: IDisposableRegistry,
        private readonly env: IApplicationEnvironment,
        protected readonly jupyterPaths: JupyterPaths
    ) {
        disposables.push(this);
        this.disposables.push(this.promiseMonitor);
        this.promiseMonitor.onStateChange(() => {
            this.status = this.promiseMonitor.isComplete ? 'idle' : 'discovering';
        });
        this.kernelSpecFinder = new LocalKernelSpecFinder(fs, memento, jupyterPaths);
        this.disposables.push(this.kernelSpecFinder);
    }
    public clearCache() {
        this.kernelSpecFinder.clearCache();
    }
    public abstract dispose(): void | undefined;
    abstract refresh(): Promise<void>;
    abstract get kernels(): T[];

    protected async listKernelsFirstTimeFromMemento(cacheKey: string): Promise<T[]> {
        const promise = (async () => {
            // Check memento too
            const cache = this.memento.get<{ kernels: T[]; extensionVersion: string }>(cacheKey, {
                kernels: [],
                extensionVersion: ''
            });

            let kernels: T[] = [];
            /**
             * The cached list of raw kernels is pointing to kernelSpec.json files in the extensions directory.
             * Assume you have version 1 of extension installed.
             * Now you update to version 2, at this point the cache still points to version 1 and the kernelSpec.json files are in the directory version 1.
             * Those files in directory for version 1 could get deleted by VS Code at any point in time, as thats an old version of the extension and user has now installed version 2.
             * Hence its wrong and buggy to use those files.
             * To ensure we don't run into weird issues with the use of cached kernelSpec.json files, we ensure the cache is tied to each version of the extension.
             */
            if (cache && Array.isArray(cache.kernels) && cache.extensionVersion === this.env.extensionVersion) {
                kernels = cache.kernels.map((item) => BaseKernelConnectionMetadata.fromJSON(item)) as T[];
            }

            // Validate
            const validValues: T[] = [];
            await Promise.all(
                kernels.map(async (item) => {
                    if (await this.isValidCachedKernel(item)) {
                        validValues.push(item);
                    }
                })
            );
            return validValues;
        })();

        this.promiseMonitor.push(promise);
        return promise;
    }

    protected async writeToMementoCache(values: T[], cacheKey: string) {
        const serialized = values.map((item) => item.toJSON());
        await Promise.all([
            removeOldCachedItems(this.memento),
            this.memento.update(cacheKey, {
                kernels: serialized,
                extensionVersion: this.env.extensionVersion
            })
        ]);
    }
    protected async isValidCachedKernel(kernel: LocalKernelConnectionMetadata): Promise<boolean> {
        switch (kernel.kind) {
            case 'startUsingPythonInterpreter':
                // Interpreters have to still exist
                return this.fs.exists(kernel.interpreter.uri);

            case 'startUsingLocalKernelSpec':
                // Spec files have to still exist and interpreters have to exist
                const promiseSpec = kernel.kernelSpec.specFile
                    ? this.fs.exists(Uri.file(kernel.kernelSpec.specFile))
                    : Promise.resolve(true);
                return promiseSpec.then((r) => {
                    return r && kernel.interpreter ? this.fs.exists(kernel.interpreter.uri) : Promise.resolve(true);
                });
        }
    }
}

/**
 * Load kernelspec json from disk
 */
export async function loadKernelSpec(
    specPath: Uri,
    fs: IFileSystemNode,
    cancelToken: CancellationToken,
    interpreter?: PythonEnvironment
): Promise<IJupyterKernelSpec | undefined> {
    // This is a backup folder for old kernels created by us.
    if (specPath.fsPath.includes(oldKernelsSpecFolderName)) {
        return;
    }
    let kernelJson: ReadWrite<IJupyterKernelSpec>;
    try {
        traceVerbose(
            `Loading kernelspec from ${getDisplayPath(specPath)} for ${
                interpreter?.uri ? getDisplayPath(interpreter.uri) : ''
            }`
        );
        kernelJson = JSON.parse(await fs.readFile(specPath));
        traceVerbose(
            `Loading kernelspec from ${getDisplayPath(specPath)} for ${
                interpreter?.uri ? getDisplayPath(interpreter.uri) : ''
            } and contents is ${JSON.stringify(kernelJson)}}`
        );
    } catch (ex) {
        traceError(`Failed to parse kernelspec ${specPath}`, ex);
        return;
    }
    if (cancelToken.isCancellationRequested) {
        return;
    }

    // Special case. If we have an interpreter path this means this spec file came
    // from an interpreter location (like a conda environment). Modify the name to make sure it fits
    // the kernel instead
    // kernelJson.originalName = kernelJson.name;
    kernelJson.name = interpreter ? await getInterpreterKernelSpecName(interpreter) : kernelJson.name;
    if (cancelToken.isCancellationRequested) {
        return;
    }

    // Update the display name too if we have an interpreter.
    const isDefaultPythonName = kernelJson.display_name.toLowerCase().match(isDefaultPythonKernelSpecSpecName);
    if (!isDefaultPythonName && kernelJson.language === PYTHON_LANGUAGE && kernelJson.argv.length > 2) {
        // Default kernel spec argv for Python kernels is `"python","-m","ipykernel_launcher","-f","{connection_file}"`
        // Some older versions had `ipykernel` instead of `ipykernel_launcher`
        // If its different, then use that as an identifier for the kernel name.
        const argv = kernelJson.argv
            .slice(1) // ignore python
            .map((arg) => arg.toLowerCase())
            .filter((arg) => !['-m', 'ipykernel', 'ipykernel_launcher', '-f', '{connection_file}'].includes(arg));
        if (argv.length) {
            kernelJson.name = `${kernelJson.name}.${argv.join('#')}`;
        }
    }
    kernelJson.metadata = kernelJson.metadata || {};
    kernelJson.metadata.vscode = kernelJson.metadata.vscode || {};
    if (!kernelJson.metadata.vscode.originalSpecFile) {
        kernelJson.metadata.vscode.originalSpecFile = specPath.fsPath;
    }
    if (!kernelJson.metadata.vscode.originalDisplayName) {
        kernelJson.metadata.vscode.originalDisplayName = kernelJson.display_name;
    }
    if (kernelJson.metadata.originalSpecFile) {
        kernelJson.metadata.vscode.originalSpecFile = kernelJson.metadata.originalSpecFile;
        delete kernelJson.metadata.originalSpecFile;
    }

    const kernelSpec: IJupyterKernelSpec = new JupyterKernelSpec(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        kernelJson as any,
        specPath.fsPath,
        // Interpreter information may be saved in the metadata (if this is a kernel spec created/registered by us).
        interpreter?.uri.fsPath || kernelJson?.metadata?.interpreter?.path,
        getKernelRegistrationInfo(kernelJson)
    );

    // Some registered kernel specs do not have a name, in this case use the last part of the path
    kernelSpec.name = kernelJson?.name || path.basename(path.dirname(specPath.fsPath));

    // Possible user deleted the underlying interpreter.
    const interpreterPath = interpreter?.uri.fsPath || kernelJson?.metadata?.interpreter?.path;
    // Do not validate interpreter paths for empty conda envs
    if (interpreterPath && !interpreter?.isCondaEnvWithoutPython && !(await fs.exists(Uri.file(interpreterPath)))) {
        return;
    }

    kernelJson.isRegisteredByVSC = getKernelRegistrationInfo(kernelJson);
    traceVerbose(
        `KernelSpec.json ${specPath.fsPath} for interpreter ${interpreter?.id} is ${JSON.stringify(kernelJson)}`
    );
    return kernelSpec;
}
