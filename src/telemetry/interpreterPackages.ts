// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IPythonApiProvider, IPythonExtensionChecker } from '../platform/api/types';
import { IPythonExecutionFactory } from '../platform/common/process/types';
import { IDisposableRegistry, InterpreterUri, Resource } from '../platform/common/types';
import { createDeferred, Deferred } from '../platform/common/utils/async';
import { isResource, noop } from '../platform/common/utils/misc';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { PythonEnvironment } from '../platform/pythonEnvironments/info';
import { getTelemetrySafeHashedString, getTelemetrySafeVersion } from '../platform/../telemetry/helpers';
import { IWorkspaceService } from '../platform/common/application/types';
import { traceWarning, traceError } from '../platform/common/logger';

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
@injectable()
export class InterpreterPackages {
    private static interpreterInformation = new Map<string, Deferred<Map<string, string>>>();
    private static pendingInterpreterInformation = new Map<string, Promise<void>>();
    private pendingInterpreterBeforeActivation = new Set<InterpreterUri>();
    private static instance?: InterpreterPackages;
    private readonly interpreterPackages = new Map<string, Promise<Set<string>>>();
    constructor(
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IPythonExecutionFactory) private readonly executionFactory: IPythonExecutionFactory,
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {
        InterpreterPackages.instance = this;
        this.apiProvider.onDidActivatePythonExtension(
            () => this.pendingInterpreterBeforeActivation.forEach((item) => this.trackPackages(item)),
            this,
            this.disposables
        );
    }
    public static getPackageVersions(interpreter: PythonEnvironment): Promise<Map<string, string>> {
        let deferred = InterpreterPackages.interpreterInformation.get(interpreter.path);
        if (!deferred) {
            deferred = createDeferred<Map<string, string>>();
            InterpreterPackages.interpreterInformation.set(interpreter.path, deferred);

            if (InterpreterPackages.instance) {
                InterpreterPackages.instance.trackInterpreterPackages(interpreter).catch(noop);
            }
        }
        return deferred.promise;
    }
    public static async getPackageVersion(
        interpreter: PythonEnvironment,
        packageName: string
    ): Promise<string | undefined> {
        const packages = await InterpreterPackages.getPackageVersions(interpreter);
        const telemetrySafeString = getTelemetrySafeHashedString(packageName.toLocaleLowerCase());
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
    public async listPackages(resource?: Resource): Promise<Set<string>> {
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
        return this.interpreterPackages.get(workspaceKey)!;
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
            traceError(`Failed to get list of installed packages for ${interpreter.path}`, modulesOutput.stderr);
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
        const key = interpreter.path;
        if (InterpreterPackages.pendingInterpreterInformation.has(key) && !ignoreCache) {
            return;
        }

        const promise = this.getPackageInformation(interpreter);
        promise.finally(() => {
            // If this promise was resolved, then remove it from the pending list.
            // But cache for at least 5m (this is used only to diagnose failures in kernels).
            const timer = setTimeout(() => {
                if (InterpreterPackages.pendingInterpreterInformation.get(key) === promise) {
                    InterpreterPackages.pendingInterpreterInformation.delete(key);
                }
            }, 300_000);
            const disposable = { dispose: () => clearTimeout(timer) };
            this.disposables.push(disposable);
        });
        InterpreterPackages.pendingInterpreterInformation.set(key, promise);
    }
    private async getPackageInformation(interpreter: PythonEnvironment) {
        const service = await this.executionFactory.createActivatedEnvironment({
            allowEnvironmentFetchExceptions: true,
            interpreter
        });

        // Ignore errors, and merge the two (in case some versions of python write to stderr).
        const output = await service.execModule('pip', ['list'], { throwOnStdErr: false, mergeStdOutErr: true });
        const packageAndVersions = new Map<string, string>();
        // Add defaults.
        interestedPackages.forEach((item) => {
            packageAndVersions.set(getTelemetrySafeHashedString(item), notInstalled);
        });
        output.stdout
            .split('\n')
            .map((line) => line.trim().toLowerCase())
            .filter((line) => line.length > 0)
            .forEach((line) => {
                const parts = line.split(' ').filter((item) => item.trim().length);
                if (parts.length < 2) {
                    return;
                }
                const [packageName, rawVersion] = parts;
                if (!interestedPackages.has(packageName.toLowerCase().trim())) {
                    return;
                }
                const version = getTelemetrySafeVersion(rawVersion);
                packageAndVersions.set(getTelemetrySafeHashedString(packageName), version || '');
            });
        let deferred = InterpreterPackages.interpreterInformation.get(interpreter.path);
        if (!deferred) {
            deferred = createDeferred<Map<string, string>>();
            InterpreterPackages.interpreterInformation.set(interpreter.path, deferred);
        }
        deferred.resolve(packageAndVersions);
    }
}
