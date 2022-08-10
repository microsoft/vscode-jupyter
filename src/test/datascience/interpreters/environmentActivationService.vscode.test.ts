// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { traceInfo } from '../../../platform/logging';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common.node';
import { initialize } from '../../initialize.node';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import {
    EnvironmentActivationService,
    EnvironmentVariablesCacheInformation
} from '../../../platform/common/process/environmentActivationService.node';
import * as path from '../../../platform/vscode-path/path';
import { IS_WINDOWS } from '../../../platform/common/platform/constants.node';
import { IProcessServiceFactory } from '../../../platform/common/process/types.node';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { GLOBAL_MEMENTO, IDisposable, IMemento } from '../../../platform/common/types';
import { IPythonApiProvider, IPythonExtensionChecker, PythonApi } from '../../../platform/api/types';
import { IServiceContainer } from '../../../platform/ioc/types';
import { IPlatformService } from '../../../platform/common/platform/types';
import { CondaService } from '../../../platform/common/process/condaService.node';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { ICustomEnvironmentVariablesProvider } from '../../../platform/common/variables/types';
import { IS_CONDA_TEST, IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { Disposable, Memento } from 'vscode';
import { instance, mock, verify } from 'ts-mockito';
import { defaultNotebookTestTimeout } from '../notebook/helper.node';
import { IFileSystem } from '../../../platform/common/platform/types';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Conda Execution) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let envActivationService: EnvironmentActivationService;
    let activeCondaInterpreter: PythonEnvironment;
    const pathEnvVariableName = IS_WINDOWS ? 'Path' : 'PATH';
    let pythonApiProvider: IPythonApiProvider;
    let extensionChecker: IPythonExtensionChecker;
    let pythonApi: PythonApi;
    let originalActiveInterpreter: PythonEnvironment | undefined;
    this.timeout(120_000);
    suiteSetup(async function () {
        if (!IS_CONDA_TEST() || IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        traceInfo('Suite Setup');
        this.timeout(120_000);
        try {
            api = await initialize();
            sinon.restore();
            pythonApiProvider = api.serviceContainer.get<IPythonApiProvider>(IPythonApiProvider);
            const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
            extensionChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
            originalActiveInterpreter = await interpreterService.getActiveInterpreter();
            if (!originalActiveInterpreter || originalActiveInterpreter.envType !== EnvironmentType.Conda) {
                const interpreters = await interpreterService.getInterpreters();
                const firstCondaInterpreter = interpreters.find((i) => i.envType === EnvironmentType.Conda);
                pythonApi = await pythonApiProvider.getApi();
                if (firstCondaInterpreter) {
                    await pythonApi.setActiveInterpreter(getFilePath(firstCondaInterpreter.uri));
                }
                activeCondaInterpreter = firstCondaInterpreter!;
            } else {
                activeCondaInterpreter = originalActiveInterpreter;
            }
            if (!activeCondaInterpreter) {
                throw new Error('Active interpreter not found');
            }
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            await captureScreenShot('execution-suite');
            throw e;
        }
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        api = await initialize();
        envActivationService = createService(api.serviceContainer);
        envActivationService.clearCache();
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        sinon.restore();
        envActivationService.clearCache();
        disposeAllDisposables(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => {
        if (originalActiveInterpreter && pythonApi) {
            pythonApi.setActiveInterpreter(getFilePath(originalActiveInterpreter.uri)).ignoreErrors();
        }
    });
    function createService(serviceContainer: IServiceContainer) {
        return new EnvironmentActivationService(
            serviceContainer.get(IPlatformService),
            serviceContainer.get(IProcessServiceFactory),
            serviceContainer.get(IWorkspaceService),
            serviceContainer.get(IInterpreterService),
            serviceContainer.get(ICustomEnvironmentVariablesProvider),
            serviceContainer.get(IPythonApiProvider),
            serviceContainer.get(IMemento, GLOBAL_MEMENTO),
            serviceContainer.get(CondaService),
            serviceContainer.get(IFileSystem),
            1
        );
    }
    test('Verify Conda Activation', async () => {
        const envVars = await envActivationService.getActivatedEnvironmentVariables(undefined, activeCondaInterpreter);
        verifyVariables(envVars!);
    });
    test('Can get conda env variables using Our code', async () => {
        const envVarsFromPython = await envActivationService.getActivatedEnvironmentVariablesFromPython(
            undefined,
            activeCondaInterpreter
        );
        verifyVariables(envVarsFromPython!);
        const envVarsOurselves = await envActivationService.getActivatedEnvironmentVariablesOurselves(
            undefined,
            activeCondaInterpreter
        );
        verifyVariables(envVarsOurselves!, '(ourselves)');
    });
    test('Activate conda environment using conda run and activation commands', async () => {
        // Ensure we don't get stuff from Python extension.
        const stub = sinon.stub(extensionChecker, 'isPythonExtensionInstalled').returns(false);
        envActivationService = createService(api.serviceContainer);
        const activatedEnvVars1 = await envActivationService.getActivatedEnvironmentVariables(
            undefined,
            activeCondaInterpreter
        );
        stub.restore();

        envActivationService = createService(api.serviceContainer);
        const activatedCommandEnvVars = await envActivationService.getActivatedEnvVarsUsingActivationCommands(
            undefined,
            activeCondaInterpreter
        );

        envActivationService = createService(api.serviceContainer);
        const activatedCondaRunEnvVars = await envActivationService.getCondaEnvVariables(
            undefined,
            activeCondaInterpreter
        );

        verifyVariables(activatedEnvVars1!, '(main)');
        verifyVariables(activatedCommandEnvVars!, '(command)');
        verifyVariables(activatedCondaRunEnvVars!, '(conda run)');
    });
    test('Verify env variables are cached and we do not attempt to get env vars using Conda scripts our selves', async function () {
        return this.skip();
        const cacheKey = envActivationService.getInterpreterEnvCacheKeyForTesting(undefined, activeCondaInterpreter);
        const memento = api.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
        await memento.update(cacheKey, undefined);

        // Ensure we get the env variables from Python extension & its cached.
        envActivationService = createService(api.serviceContainer);
        await envActivationService.getActivatedEnvironmentVariables(undefined, activeCondaInterpreter);

        // Wait for cache to get updated (could be slow if Python extension is slow).
        await waitForCondition(
            async () => memento.get(cacheKey) !== undefined,
            defaultNotebookTestTimeout,
            'Cache not updated'
        );
        envActivationService.dispose();

        // Update the cache so we can test and ensure we get the env variables from the cache.
        const env = { HELLO: Date.now().toString() };
        const cachedData = Object.assign({}, memento.get<EnvironmentVariablesCacheInformation>(cacheKey)!);
        cachedData.activatedEnvVariables = env;

        // Ensure no other code (such as extension code which is running while tests run),
        // gets to update this cache entry.
        const stub = sinon.stub(memento, 'update').callsFake(async (key: string, value: any) => {
            if (key !== cacheKey || value === cachedData) {
                return (memento.update as any).wrappedMethod.apply(memento, [key, value]);
            }
            return Promise.resolve();
        });
        await memento.update(cacheKey, cachedData);
        // Verify data is in cache.
        // Some times while extension code is running the cache can get cleared.
        assert.strictEqual(
            memento.get<EnvironmentVariablesCacheInformation>(cacheKey)!.activatedEnvVariables!.HELLO,
            env.HELLO,
            'Env variables not in cache anymore'
        );

        disposables.push(new Disposable(() => stub.restore()));

        // Create a whole new instance.
        // This time ensure Python is slow to get the env variables
        const mockConda = mock(CondaService);
        envActivationService = new EnvironmentActivationService(
            api.serviceContainer.get(IPlatformService),
            api.serviceContainer.get(IProcessServiceFactory),
            api.serviceContainer.get(IWorkspaceService),
            api.serviceContainer.get(IInterpreterService),
            api.serviceContainer.get(ICustomEnvironmentVariablesProvider),
            api.serviceContainer.get(IPythonApiProvider),
            api.serviceContainer.get(IMemento, GLOBAL_MEMENTO),
            instance(mockConda),
            api.serviceContainer.get(IFileSystem),
            1
        );

        // Get the env variables from a new instance of the class.
        // Use a new instance to ensure we don't use any in-memory cache.
        const activatedEnvVars1 = await envActivationService.getActivatedEnvironmentVariables(
            undefined,
            activeCondaInterpreter
        );

        // Verify data is still in cache (possible it got blown away by some other test)
        assert.strictEqual(
            memento.get<EnvironmentVariablesCacheInformation>(cacheKey)!.activatedEnvVariables!.HELLO,
            env.HELLO,
            'Env variables not in cache'
        );

        // Ensure we get the env variables from the cache.
        assert.strictEqual(activatedEnvVars1!.HELLO, env.HELLO);

        // Ensure we didn't run conda run (just check if we tried to get conda information).
        verify(mockConda.getCondaFile()).never();
        verify(mockConda.getCondaVersion()).never();
    });
    function verifyVariables(envVars: NodeJS.ProcessEnv, errorMessageSuffix: string = '') {
        assert.ok(envVars, `Conda Env Vars not set ${errorMessageSuffix}`);
        assert.strictEqual(
            envVars.CONDA_DEFAULT_ENV,
            activeCondaInterpreter.envName,
            `Activated env not set ${errorMessageSuffix}`
        );
        assert.strictEqual(
            envVars.CONDA_PREFIX,
            activeCondaInterpreter.sysPrefix,
            `Activated env Prefix not set ${errorMessageSuffix}`
        );
        const execPath = path.dirname(activeCondaInterpreter.uri.fsPath).toLowerCase();
        const potentialPathVariable = envVars['Path'] || envVars['PATH'];
        assert.ok(
            potentialPathVariable?.toLowerCase().includes(execPath),
            `Path for Conda should be at the inside of ENV[PATH], expected ${execPath} to be inside of ${envVars[pathEnvVariableName]} ${errorMessageSuffix}`
        );
    }
});
