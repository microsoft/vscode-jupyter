// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { traceInfo } from '../../../client/common/logger';
import { captureScreenShot, IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import { PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { EnvironmentActivationService } from '../../../client/common/process/interpreterActivation';
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
/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Conda Execution) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let envActivationService: EnvironmentActivationService;
    let activeCondaInterpreter: PythonEnvironment;
    const pathEnvVariableName = IS_WINDOWS ? 'Path' : 'PATH';
    let pythonApi: IPythonApiProvider;
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
            pythonApi = api.serviceContainer.get<IPythonApiProvider>(IPythonApiProvider);
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
            serviceContainer.get(IFileSystem)
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
    test('Test activation using conda run and activation commands', async () => {
        // Ensure we don't get stuff from Python extension.
        const deferred = createDeferred<PythonApi>();
        const stub = sinon.stub(pythonApi, 'getApi').returns(deferred.promise);
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
