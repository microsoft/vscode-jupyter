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
import { EnvironmentActivationService } from '../../../platform/common/process/environmentActivationService.node';
import * as path from '../../../platform/vscode-path/path';
import { IS_WINDOWS } from '../../../platform/common/platform/constants.node';
import { IProcessServiceFactory } from '../../../platform/common/process/types.node';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { GLOBAL_MEMENTO, IDisposable, IMemento } from '../../../platform/common/types';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { IServiceContainer } from '../../../platform/ioc/types';
import { IPlatformService } from '../../../platform/common/platform/types';
import { CondaService } from '../../../platform/common/process/condaService.node';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { ICustomEnvironmentVariablesProvider } from '../../../platform/common/variables/types';
import { IS_CONDA_TEST, IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { IFileSystem } from '../../../platform/common/platform/types';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { ProposedExtensionAPI } from '../../../platform/api/pythonApiTypes';
import { defaultNotebookTestTimeout } from '../notebook/helper';
/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Conda Execution @python @mandatory', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let envActivationService: EnvironmentActivationService;
    let activeCondaInterpreter: PythonEnvironment;
    const pathEnvVariableName = IS_WINDOWS ? 'Path' : 'PATH';
    let pythonApiProvider: IPythonApiProvider;
    let extensionChecker: IPythonExtensionChecker;
    let pythonApi: ProposedExtensionAPI;
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
                const interpreters = interpreterService.resolvedEnvironments;
                await waitForCondition(
                    () => interpreters.find((i) => i.envType === EnvironmentType.Conda) !== undefined,
                    defaultNotebookTestTimeout,
                    'Waiting for interpreters to be discovered'
                );

                const firstCondaInterpreter = interpreters.find((i) => i.envType === EnvironmentType.Conda);
                pythonApi = (await pythonApiProvider.getNewApi())!;
                if (firstCondaInterpreter) {
                    await pythonApi?.environments.updateActiveEnvironmentPath(getFilePath(firstCondaInterpreter.uri));
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
    suiteTeardown(async () => {
        if (originalActiveInterpreter && pythonApi) {
            await pythonApi.environments
                .updateActiveEnvironmentPath(getFilePath(originalActiveInterpreter.uri))
                .ignoreErrors();
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
