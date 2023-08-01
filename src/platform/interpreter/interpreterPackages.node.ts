// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IPythonApiProvider, IPythonExtensionChecker } from '../api/types';
import { IDisposableRegistry, InterpreterUri, Resource } from '../common/types';
import { createDeferred, Deferred } from '../common/utils/async';
import { isResource, noop } from '../common/utils/misc';
import { IInterpreterService } from './contracts';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { getComparisonKey } from '../vscode-path/resources';
import { getTelemetrySafeHashedString, getTelemetrySafeVersion } from '../telemetry/helpers';
import { IWorkspaceService } from '../common/application/types';
import { traceError, traceWarning } from '../logging';
import { getDisplayPath } from '../common/platform/fs-paths.node';
import { IInterpreterPackages } from './types';
import { IPythonExecutionFactory } from './types.node';

const interestedPackages = new Set(
    [
        'ipykernel',
        'ipython-genutils',
        'jupyter',
        'jupyter-client',
        'jupyter-core',
        'ipywidgets',
        'nbconvert',
        'nbformat',
        'notebook',
        'pyzmq',
        'pyzmq32',
        'tornado',
        'traitlets'
    ].map((item) => item.toLowerCase())
);

const notInstalled = 'NOT INSTALLED';

/**
 * Gets information about packages installed in a given interpreter.
 */
@injectable()
export class InterpreterPackages implements IInterpreterPackages {
    private interpreterInformation = new Map<string, Deferred<Map<string, string>>>();
    private pendingInterpreterInformation = new Map<string, Promise<void>>();
    private pendingInterpreterBeforeActivation = new Set<InterpreterUri>();
    private static _instance: InterpreterPackages | undefined;
    private readonly interpreterPackages = new Map<string, Promise<Set<string>>>();
    constructor(
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IPythonExecutionFactory) private readonly executionFactory: IPythonExecutionFactory,
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {
        InterpreterPackages._instance = this;
        this.apiProvider.onDidActivatePythonExtension(
            () => this.pendingInterpreterBeforeActivation.forEach((item) => this.trackPackages(item)),
            this,
            this.disposables
        );
    }
    public static get instance() {
        return InterpreterPackages._instance;
    }
    public getPackageVersions(interpreter: PythonEnvironment): Promise<Map<string, string>> {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            return Promise.resolve(new Map<string, string>());
        }
        const key = getComparisonKey(interpreter.uri);
        let deferred = this.interpreterInformation.get(key);
        if (!deferred) {
            deferred = createDeferred<Map<string, string>>();
            this.interpreterInformation.set(key, deferred);
            this.trackInterpreterPackages(interpreter).catch(noop);
        }
        return deferred.promise;
    }
    public async getPackageVersion(interpreter: PythonEnvironment, packageName: string): Promise<string | undefined> {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            return Promise.resolve(undefined);
        }
        const packages = await this.getPackageVersions(interpreter);
        const telemetrySafeString = await getTelemetrySafeHashedString(packageName.toLocaleLowerCase());
        if (!packages.has(telemetrySafeString)) {
            return;
        }
        const version = packages.get(telemetrySafeString);
        if (!version) {
            return;
        }
        return version === notInstalled ? undefined : version;
    }
    public trackPackages(interpreterUri: InterpreterUri, ignoreCache?: boolean) {
        this.trackPackagesInternal(interpreterUri, ignoreCache).catch(noop);
    }
    /**
     * Lists all packages that are accessible from the interpreter.
     */
    public async listPackages(resource?: Resource): Promise<string[]> {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            return [];
        }

        const workspaceKey = this.workspace.getWorkspaceFolderIdentifier(resource);
        if (!this.interpreterPackages.has(workspaceKey)) {
            const promise = this.listPackagesImpl(resource);
            this.interpreterPackages.set(workspaceKey, promise);
            promise.catch((ex) => {
                if (this.interpreterPackages.get(workspaceKey) === promise) {
                    this.interpreterPackages.delete(workspaceKey)!;
                }
                traceWarning(`Failed to get list of installed packages for ${workspaceKey}`, ex);
            });
        }
        return this.interpreterPackages.get(workspaceKey)!.then((items) => Array.from(items));
    }
    private async listPackagesImpl(resource?: Resource): Promise<Set<string>> {
        const interpreter = await this.interpreterService.getActiveInterpreter(resource);
        if (!interpreter) {
            return new Set<string>();
        }
        const service = await this.executionFactory.createActivatedEnvironment({ interpreter, resource });
        const separator = '389a87b7-288f-4235-92bf-73bf19bf6491';
        const code = `import pkgutil;import json;print("${separator}");print(json.dumps(list([x.name for x in pkgutil.iter_modules()])));print("${separator}");`;
        const modulesOutput = await service.exec(['-c', code], { throwOnStdErr: false });
        if (modulesOutput.stdout) {
            const modules = JSON.parse(modulesOutput.stdout.split(separator)[1].trim()) as string[];
            return new Set(modules.concat(modules.map((item) => item.toLowerCase())));
        } else {
            traceError(
                `Failed to get list of installed packages for ${getDisplayPath(interpreter.uri)}`,
                modulesOutput.stderr
            );
            return new Set<string>();
        }
    }

    private async trackPackagesInternal(interpreterUri: InterpreterUri, ignoreCache?: boolean) {
        if (!this.pythonExtensionChecker.isPythonExtensionActive) {
            this.pendingInterpreterBeforeActivation.add(interpreterUri);
            return;
        }
        let interpreter: PythonEnvironment;
        if (isResource(interpreterUri)) {
            // Get details of active interpreter for the Uri provided.
            const activeInterpreter = await this.interpreterService.getActiveInterpreter(interpreterUri);
            if (!activeInterpreter) {
                return;
            }
            interpreter = activeInterpreter;
        } else {
            interpreter = interpreterUri;
        }
        this.trackInterpreterPackages(interpreter, ignoreCache).catch(noop);
    }
    private async trackInterpreterPackages(interpreter: PythonEnvironment, ignoreCache?: boolean) {
        const key = getComparisonKey(interpreter.uri);
        if (this.pendingInterpreterInformation.has(key) && !ignoreCache) {
            return;
        }

        const promise = this.getPackageInformation({ interpreter });
        promise
            .finally(() => {
                // If this promise was resolved, then remove it from the pending list.
                // But cache for at least 5m (this is used only to diagnose failures in kernels).
                const timer = setTimeout(() => {
                    if (this.pendingInterpreterInformation.get(key) === promise) {
                        this.pendingInterpreterInformation.delete(key);
                    }
                }, 300_000);
                const disposable = { dispose: () => clearTimeout(timer) };
                this.disposables.push(disposable);
            })
            .catch(noop);
        this.pendingInterpreterInformation.set(key, promise);
    }

    private async getPackageInformation({ interpreter }: { interpreter: PythonEnvironment }) {
        if (interpreter.isCondaEnvWithoutPython) {
            return;
        }
        const service = await this.executionFactory.createActivatedEnvironment({
            interpreter
        });

        // Ignore errors, and merge the two (in case some versions of python write to stderr).
        const output = await service.execModule('pip', ['list'], { throwOnStdErr: false, mergeStdOutErr: true });
        const packageAndVersions = new Map<string, string>();
        // Add defaults.
        await Promise.all(
            Array.from(interestedPackages).map(async (item) => {
                packageAndVersions.set(await getTelemetrySafeHashedString(item), notInstalled);
            })
        );
        await Promise.all(
            output.stdout
                .split('\n')
                .map((line) => line.trim().toLowerCase())
                .filter((line) => line.length > 0)
                .map(async (line) => {
                    const parts = line.split(' ').filter((item) => item.trim().length);
                    if (parts.length < 2) {
                        return;
                    }
                    const [packageName, rawVersion] = parts;
                    if (!interestedPackages.has(packageName.toLowerCase().trim())) {
                        return;
                    }
                    const version = getTelemetrySafeVersion(rawVersion);
                    packageAndVersions.set(await getTelemetrySafeHashedString(packageName), version || '');
                })
        );
        const key = getComparisonKey(interpreter.uri);
        let deferred = this.interpreterInformation.get(key);
        if (!deferred) {
            deferred = createDeferred<Map<string, string>>();
            this.interpreterInformation.set(key, deferred);
        }
        deferred.resolve(packageAndVersions);
    }
}
