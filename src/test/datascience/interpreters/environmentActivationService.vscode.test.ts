// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { traceInfo } from '../../../client/common/logger';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common';
import { initialize } from '../../initialize';
import { PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import {
    EnvironmentActivationService,
    EnvironmentVariablesCacheInformation
} from '../../../client/common/process/environmentActivationService';
import * as path from 'path';
import { IS_WINDOWS } from '../../../client/common/platform/constants';
import { IProcessServiceFactory } from '../../../client/common/process/types';
import { disposeAllDisposables } from '../../../client/common/helpers';
import { GLOBAL_MEMENTO, IDisposable, IMemento } from '../../../client/common/types';
import { createDeferred } from '../../../client/common/utils/async';
import { IPythonApiProvider, PythonApi } from '../../../client/api/types';
import { IServiceContainer } from '../../../client/ioc/types';
import { IFileSystem, IPlatformService } from '../../../client/common/platform/types';
import { CondaService } from '../../../client/common/process/condaService';
import { IWorkspaceService } from '../../../client/common/application/types';
import { CurrentProcess } from '../../../client/common/process/currentProcess';
import { IEnvironmentVariablesProvider } from '../../../client/common/variables/types';
import { IS_CONDA_TEST, IS_REMOTE_NATIVE_TEST } from '../../constants';
import { Disposable, Memento } from 'vscode';
import { defaultNotebookTestTimeout } from '../notebook/helper';
import { instance, mock, verify } from 'ts-mockito';
/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Conda Execution) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let envActivationService: EnvironmentActivationService;
    let activeCondaInterpreter: PythonEnvironment;
    const pathEnvVariableName = IS_WINDOWS ? 'Path' : 'PATH';
    let pythonApiProvider: IPythonApiProvider;
    this.timeout(120_000);
    suiteSetup(async function () {
        if (!IS_CONDA_TEST || IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        traceInfo('Suite Setup');
        this.timeout(120_000);
        try {
            api = await initialize();
            sinon.restore();
            pythonApiProvider = api.serviceContainer.get<IPythonApiProvider>(IPythonApiProvider);
            const interpreter = await api.serviceContainer
                .get<IInterpreterService>(IInterpreterService)
                .getActiveInterpreter();
            if (!interpreter) {
                throw new Error('Active interpreter not found');
            }
            activeCondaInterpreter = interpreter;
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            await captureScreenShot('execution-suite');
            throw e;
        }
    });
    setup(async () => {
        api = await initialize();
        envActivationService = createService(api.serviceContainer);
        envActivationService.clearCache();
    });
    teardown(() => {
        sinon.restore();
        envActivationService.clearCache();
        disposeAllDisposables(disposables);
    });
    function createService(serviceContainer: IServiceContainer) {
        return new EnvironmentActivationService(
            serviceContainer.get(IPlatformService),
            serviceContainer.get(IProcessServiceFactory),
            serviceContainer.get(CurrentProcess),
            serviceContainer.get(IWorkspaceService),
            serviceContainer.get(IInterpreterService),
            serviceContainer.get(IEnvironmentVariablesProvider),
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
    test('Acitvate conda environment using conda run and activation commands', async () => {
        // Ensure we don't get stuff from Python extension.
        const deferred = createDeferred<PythonApi>();
        const stub = sinon.stub(pythonApiProvider, 'getApi').returns(deferred.promise);
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
    test('Verify env variables are cached and we do not attempt to get env vars using Conda scripts our selves', async () => {
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
        disposables.push(new Disposable(() => stub.restore()));

        // Create a whole new instance.
        // This time ensure Python is slow to get the env variables
        const mockConda = mock(CondaService);
        envActivationService = new EnvironmentActivationService(
            api.serviceContainer.get(IPlatformService),
            api.serviceContainer.get(IProcessServiceFactory),
            api.serviceContainer.get(CurrentProcess),
            api.serviceContainer.get(IWorkspaceService),
            api.serviceContainer.get(IInterpreterService),
            api.serviceContainer.get(IEnvironmentVariablesProvider),
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
        const execPath = path.dirname(activeCondaInterpreter.path);
        assert.ok(
            envVars[pathEnvVariableName]?.startsWith(execPath),
            `Path for Conda should be at the start of ENV[PATH], expected ${execPath} to be in front of ${envVars[pathEnvVariableName]} ${errorMessageSuffix}`
        );
    }
});
