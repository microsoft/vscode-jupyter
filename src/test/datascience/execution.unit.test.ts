// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from '../../platform/vscode-path/path';
import { Observable } from 'rxjs/Observable';
import { SemVer } from 'semver';
import { anything, instance, match, mock, reset, when } from 'ts-mockito';
import { Matcher } from 'ts-mockito/lib/matcher/type/Matcher';
import * as TypeMoq from 'typemoq';
import uuid from 'uuid/v4';
import { CancellationTokenSource, ConfigurationChangeEvent, Disposable, EventEmitter, Uri } from 'vscode';
import { ApplicationShell } from '../../platform/common/application/applicationShell';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import { WorkspaceService } from '../../platform/common/application/workspace.node';
import { ConfigurationService } from '../../platform/common/configuration/service.node';
import { PersistentState, PersistentStateFactory } from '../../platform/common/persistentState';
import { FileSystem } from '../../platform/common/platform/fileSystem.node';
import { IFileSystem } from '../../platform/common/platform/types';
import { ProcessServiceFactory } from '../../platform/common/process/processFactory.node';
import { PythonExecutionFactory } from '../../platform/common/process/pythonExecutionFactory.node';
import {
    ExecutionResult,
    IProcessService,
    IProcessServiceFactory,
    IPythonDaemonExecutionService,
    IPythonExecutionFactory,
    IPythonExecutionService,
    ObservableExecutionResult,
    Output
} from '../../platform/common/process/types.node';
import { IAsyncDisposableRegistry, IConfigurationService, IOutputChannel } from '../../platform/common/types';
import { EXTENSION_ROOT_DIR } from '../../platform/constants.node';
import { IEnvironmentActivationService } from '../../platform/interpreter/activation/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { ServiceContainer } from '../../platform/ioc/container';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { areInterpreterPathsSame } from '../../platform/pythonEnvironments/info/interpreter';
import { getKernelId } from '../../kernels/helpers';
import { Product } from '../../kernels/installer/types';
import { JupyterInterpreterDependencyService } from '../../kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node';
import { JupyterInterpreterOldCacheStateStore } from '../../kernels/jupyter/interpreter/jupyterInterpreterOldCacheStateStore.node';
import { JupyterInterpreterService } from '../../kernels/jupyter/interpreter/jupyterInterpreterService.node';
import { JupyterInterpreterSubCommandExecutionService } from '../../kernels/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService.node';
import { HostJupyterExecution } from '../../kernels/jupyter/launcher/liveshare/hostJupyterExecution';
import { NotebookStarter } from '../../kernels/jupyter/launcher/notebookStarter.node';
import { JupyterPaths } from '../../kernels/raw/finder/jupyterPaths.node';
import { LocalKernelFinder } from '../../kernels/raw/finder/localKernelFinder.node';
import { IJupyterConnection, IJupyterKernelSpec, LocalKernelConnectionMetadata } from '../../kernels/types';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants.node';
import { noop } from '../core';
import { MockOutputChannel } from '../mockClasses';
import { MockJupyterServer } from './mockJupyterServer';
import { MockJupyterSettings } from './mockJupyterSettings';
import { DisplayOptions } from '../../kernels/displayOptions';
import { INotebookServerFactory } from '../../kernels/jupyter/types';
import { IJupyterSubCommandExecutionService } from '../../kernels/jupyter/types.node';
import { SystemVariables } from '../../platform/common/variables/systemVariables.node';
import { getOSType, OSType } from '../../platform/common/utils/platform';
import { JupyterServerUriStorage } from '../../kernels/jupyter/launcher/serverUriStorage';
import { JupyterConnection } from '../../kernels/jupyter/jupyterConnection';

/* eslint-disable @typescript-eslint/no-explicit-any, , no-multi-str,  */
class DisposableRegistry implements IAsyncDisposableRegistry {
    private disposables: Disposable[] = [];

    public push = (disposable: Disposable) => this.disposables.push(disposable);

    public dispose = async (): Promise<void> => {
        for (const disposable of this.disposables) {
            if (!disposable) {
                continue;
            }
            const val = disposable.dispose();
            if (val instanceof Promise) {
                const promise = val as Promise<void>;
                await promise;
            }
        }
        this.disposables = [];
    };
}

suite('Jupyter Execution', async () => {
    const interpreterService = mock<IInterpreterService>();
    const jupyterOutputChannel = new MockOutputChannel('');
    const executionFactory = mock(PythonExecutionFactory);
    const configService = mock(ConfigurationService);
    const application = mock(ApplicationShell);
    const processServiceFactory = mock(ProcessServiceFactory);
    const fileSystem = mock(FileSystem);
    const activationHelper = mock<IEnvironmentActivationService>();
    const serviceContainer = mock(ServiceContainer);
    const workspaceService = mock(WorkspaceService);
    const disposableRegistry = new DisposableRegistry();
    const dummyEvent = new EventEmitter<void>();
    const configChangeEvent = new EventEmitter<ConfigurationChangeEvent>();
    const pythonSettings = new MockJupyterSettings(undefined, SystemVariables, 'node', instance(workspaceService));
    const jupyterOnPath = getOSType() === OSType.Windows ? '/foo/bar/jupyter.exe' : '/foo/bar/jupyter';
    let ipykernelInstallCount = 0;
    let notebookStarter: NotebookStarter;
    const workingPython: PythonEnvironment = {
        uri: Uri.file('/foo/bar/python.exe'),
        version: new SemVer('3.6.6-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python'
    };

    const missingKernelPython: PythonEnvironment = {
        uri: Uri.file('/foo/baz/python.exe'),
        version: new SemVer('3.1.1-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python'
    };

    const missingNotebookPython: PythonEnvironment = {
        uri: Uri.file('/bar/baz/python.exe'),
        version: new SemVer('2.1.1-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python'
    };

    const missingNotebookPython2: PythonEnvironment = {
        uri: Uri.file('/two/baz/python.exe'),
        version: new SemVer('2.1.1'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python'
    };

    let workingKernelSpec: string;

    suiteSetup(() => {
        noop();
    });
    suiteTeardown(() => {
        noop();
    });

    setup(() => {
        workingKernelSpec = createTempSpec(workingPython.uri.fsPath);
        ipykernelInstallCount = 0;
        // eslint-disable-next-line no-invalid-this
    });

    teardown(() => {
        reset(fileSystem);
        return cleanupDisposables();
    });

    function cleanupDisposables(): Promise<void> {
        return disposableRegistry.dispose();
    }

    // eslint-disable-next-line max-classes-per-file
    class FunctionMatcher extends Matcher {
        private func: (obj: any) => boolean;
        constructor(func: (obj: any) => boolean) {
            super();
            this.func = func;
        }
        public override match(value: Object): boolean {
            return this.func(value);
        }
        public override toString(): string {
            return 'FunctionMatcher';
        }
    }

    function createTempSpec(pythonPath: string): string {
        const tempDir = os.tmpdir();
        const subDir = uuid();
        const filePath = path.join(tempDir, subDir, 'kernel.json');
        fs.ensureDirSync(path.dirname(filePath));
        fs.writeJSONSync(filePath, {
            display_name: 'Python 3',
            language: 'python',
            argv: [pythonPath, '-m', 'ipykernel_launcher', '-f', '{connection_file}']
        });
        return filePath;
    }

    function argThat(func: (obj: any) => boolean): any {
        return new FunctionMatcher(func);
    }

    function createTypeMoq<T>(tag: string): TypeMoq.IMock<T> {
        // Use typemoqs for those things that are resolved as promises. mockito doesn't allow nesting of mocks. ES6 Proxy class
        // is the problem. We still need to make it thenable though. See this issue: https://github.com/florinn/typemoq/issues/67
        const result: TypeMoq.IMock<T> = TypeMoq.Mock.ofType<T>();
        (result as any).tag = tag;
        result.setup((x: any) => x.then).returns(() => undefined);
        return result;
    }

    function argsMatch(matchers: (string | RegExp)[], args: string[]): boolean {
        if (matchers.length === args.length) {
            return args.every((s, i) => {
                const r = matchers[i] as RegExp;
                return r && r.test ? r.test(s) : s === matchers[i];
            });
        }
        return false;
    }

    function setupPythonService(
        service: TypeMoq.IMock<IPythonExecutionService>,
        module: string | undefined,
        args: (string | RegExp)[],
        result: Promise<ExecutionResult<string>>
    ) {
        if (module) {
            service
                .setup((x) =>
                    x.execModule(
                        TypeMoq.It.isValue(module),
                        TypeMoq.It.is((a) => argsMatch(args, a)),
                        TypeMoq.It.isAny()
                    )
                )
                .returns(() => result);
            const withModuleArgs = ['-m', module, ...args];
            service
                .setup((x) =>
                    x.exec(
                        TypeMoq.It.is((a) => argsMatch(withModuleArgs, a)),
                        TypeMoq.It.isAny()
                    )
                )
                .returns(() => result);
        } else {
            service
                .setup((x) =>
                    x.exec(
                        TypeMoq.It.is((a) => argsMatch(args, a)),
                        TypeMoq.It.isAny()
                    )
                )
                .returns(() => result);
        }
    }

    function setupPythonServiceWithFunc(
        service: TypeMoq.IMock<IPythonExecutionService>,
        module: string,
        args: (string | RegExp)[],
        result: () => Promise<ExecutionResult<string>>
    ) {
        service
            .setup((x) =>
                x.execModule(
                    TypeMoq.It.isValue(module),
                    TypeMoq.It.is((a) => argsMatch(args, a)),
                    TypeMoq.It.isAny()
                )
            )
            .returns(result);
        const withModuleArgs = ['-m', module, ...args];
        service
            .setup((x) =>
                x.exec(
                    TypeMoq.It.is((a) => argsMatch(withModuleArgs, a)),
                    TypeMoq.It.isAny()
                )
            )
            .returns(result);
        service
            .setup((x) =>
                x.execModule(
                    TypeMoq.It.isValue(module),
                    TypeMoq.It.is((a) => argsMatch(args, a)),
                    TypeMoq.It.isAny()
                )
            )
            .returns(result);
    }

    function setupPythonServiceExecObservable(
        service: TypeMoq.IMock<IPythonExecutionService>,
        module: string,
        args: (string | RegExp)[],
        stderr: string[],
        stdout: string[]
    ) {
        const result: ObservableExecutionResult<string> = {
            proc: undefined,
            out: new Observable<Output<string>>((subscriber) => {
                stderr.forEach((s) => subscriber.next({ source: 'stderr', out: s }));
                stdout.forEach((s) => subscriber.next({ source: 'stderr', out: s }));
            }),
            dispose: () => {
                noop();
            }
        };

        service
            .setup((x) =>
                x.execModuleObservable(
                    TypeMoq.It.isValue(module),
                    TypeMoq.It.is((a) => argsMatch(args, a)),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => result);
        const withModuleArgs = ['-m', module, ...args];
        service
            .setup((x) =>
                x.execObservable(
                    TypeMoq.It.is((a) => argsMatch(withModuleArgs, a)),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => result);
    }

    function setupProcessServiceExec(
        service: TypeMoq.IMock<IProcessService>,
        file: string,
        args: (string | RegExp)[],
        result: Promise<ExecutionResult<string>>
    ) {
        service
            .setup((x) =>
                x.exec(
                    TypeMoq.It.isValue(file),
                    TypeMoq.It.is((a) => argsMatch(args, a)),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => result);
    }

    function setupProcessServiceExecWithFunc(
        service: TypeMoq.IMock<IProcessService>,
        file: string,
        args: (string | RegExp)[],
        result: () => Promise<ExecutionResult<string>>
    ) {
        service
            .setup((x) =>
                x.exec(
                    TypeMoq.It.isValue(file),
                    TypeMoq.It.is((a) => argsMatch(args, a)),
                    TypeMoq.It.isAny()
                )
            )
            .returns(result);
    }

    function setupProcessServiceExecObservable(
        service: TypeMoq.IMock<IProcessService>,
        file: string,
        args: (string | RegExp)[],
        stderr: string[],
        stdout: string[]
    ) {
        const result: ObservableExecutionResult<string> = {
            proc: undefined,
            out: new Observable<Output<string>>((subscriber) => {
                stderr.forEach((s) => subscriber.next({ source: 'stderr', out: s }));
                stdout.forEach((s) => subscriber.next({ source: 'stderr', out: s }));
            }),
            dispose: () => {
                noop();
            }
        };

        service
            .setup((x) =>
                x.execObservable(
                    TypeMoq.It.isValue(file),
                    TypeMoq.It.is((a) => argsMatch(args, a)),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => result);
    }

    function createKernelSpecs(specs: { name: string; resourceDir: string }[]): Record<string, any> {
        const models: Record<string, any> = {};
        specs.forEach((spec) => {
            models[spec.name] = {
                resource_dir: spec.resourceDir,
                spec: {
                    name: spec.name,
                    display_name: spec.name,
                    language: 'python'
                }
            };
        });
        return models;
    }
    function setupWorkingPythonService(
        service: TypeMoq.IMock<IPythonExecutionService>,
        notebookStdErr?: string[],
        runInDocker?: boolean
    ) {
        setupPythonService(service, 'ipykernel', ['--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupPythonService(service, 'jupyter', ['nbconvert', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupPythonService(service, 'jupyter', ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupPythonService(service, 'jupyter', ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        service.setup((x) => x.getInterpreterInformation()).returns(() => Promise.resolve(workingPython));

        // Don't mind the goofy path here. It's supposed to not find the item. It's just testing the internal regex works
        setupPythonServiceWithFunc(service, 'jupyter', ['kernelspec', 'list', '--json'], () => {
            // Return different results after we install our kernel
            if (ipykernelInstallCount > 0) {
                const kernelSpecs = createKernelSpecs([
                    { name: 'working', resourceDir: path.dirname(workingKernelSpec) },
                    {
                        name: '0e8519db-0895-416c-96df-fa80131ecea0',
                        resourceDir:
                            'C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0'
                    }
                ]);
                return Promise.resolve({ stdout: JSON.stringify(kernelSpecs) });
            } else {
                const kernelSpecs = createKernelSpecs([
                    {
                        name: '0e8519db-0895-416c-96df-fa80131ecea0',
                        resourceDir:
                            'C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0'
                    }
                ]);
                return Promise.resolve({ stdout: JSON.stringify(kernelSpecs) });
            }
        });
        const kernelSpecs2 = createKernelSpecs([
            { name: 'working', resourceDir: path.dirname(workingKernelSpec) },
            {
                name: '0e8519db-0895-416c-96df-fa80131ecea0',
                resourceDir:
                    'C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0'
            }
        ]);
        setupPythonService(
            service,
            'jupyter',
            ['kernelspec', 'list', '--json'],
            Promise.resolve({ stdout: JSON.stringify(kernelSpecs2) })
        );
        setupPythonServiceWithFunc(
            service,
            'ipykernel',
            ['install', '--user', '--name', /\w+-\w+-\w+-\w+-\w+/, '--display-name', `'Interactive'`],
            () => {
                ipykernelInstallCount += 1;
                const kernelSpecs = createKernelSpecs([
                    { name: 'somename', resourceDir: path.dirname(workingKernelSpec) }
                ]);
                return Promise.resolve({ stdout: JSON.stringify(kernelSpecs) });
            }
        );
        const getServerInfoPath = path.join(
            EXTENSION_ROOT_DIR,
            'pythonFiles',
            'vscode_datascience_helpers',
            'getServerInfo.py'
        );
        setupPythonService(
            service,
            undefined,
            [getServerInfoPath],
            Promise.resolve({ stdout: 'failure to get server infos' })
        );
        setupPythonServiceExecObservable(service, 'jupyter', ['kernelspec', 'list', '--json'], [], []);
        const dockerArgs = runInDocker ? ['--ip', '127.0.0.1'] : [];
        setupPythonServiceExecObservable(
            service,
            'jupyter',
            [
                'notebook',
                '--no-browser',
                /--notebook-dir=.*/,
                /--config=.*/,
                '--NotebookApp.iopub_data_rate_limit=10000000000.0',
                ...dockerArgs
            ],
            [],
            notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']
        );
    }

    function setupMissingKernelPythonService(
        service: TypeMoq.IMock<IPythonExecutionService>,
        notebookStdErr?: string[]
    ) {
        setupPythonService(service, 'jupyter', ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupPythonService(service, 'jupyter', ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        service.setup((x) => x.getInterpreterInformation()).returns(() => Promise.resolve(missingKernelPython));
        const kernelSpecs = createKernelSpecs([{ name: 'working', resourceDir: path.dirname(workingKernelSpec) }]);
        setupPythonService(
            service,
            'jupyter',
            ['kernelspec', 'list', '--json'],
            Promise.resolve({ stdout: JSON.stringify(kernelSpecs) })
        );
        const getServerInfoPath = path.join(
            EXTENSION_ROOT_DIR,
            'pythonFiles',
            'vscode_datascience_helpers',
            'getServerInfo.py'
        );
        setupPythonService(
            service,
            undefined,
            [getServerInfoPath],
            Promise.resolve({ stdout: 'failure to get server infos' })
        );
        setupPythonServiceExecObservable(service, 'jupyter', ['kernelspec', 'list', '--json'], [], []);
        setupPythonServiceExecObservable(
            service,
            'jupyter',
            [
                'notebook',
                '--no-browser',
                /--notebook-dir=.*/,
                /--config=.*/,
                '--NotebookApp.iopub_data_rate_limit=10000000000.0'
            ],
            [],
            notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']
        );
    }

    function setupMissingNotebookPythonService(service: TypeMoq.IMock<IPythonExecutionService>) {
        service
            .setup((x) => x.execModule(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((_v) => {
                return Promise.reject('cant exec');
            });
        service
            .setup((x) => x.execModuleObservable(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                throw new Error('Not supported');
            });
        service.setup((x) => x.getInterpreterInformation()).returns(() => Promise.resolve(missingNotebookPython));
    }

    function setupWorkingProcessService(service: TypeMoq.IMock<IProcessService>, notebookStdErr?: string[]) {
        // Don't mind the goofy path here. It's supposed to not find the item. It's just testing the internal regex works
        setupProcessServiceExecWithFunc(
            service,
            workingPython.uri.fsPath,
            ['-m', 'jupyter', 'kernelspec', 'list', '--json'],
            () => {
                // Return different results after we install our kernel
                if (ipykernelInstallCount > 0) {
                    const kernelSpecs = createKernelSpecs([
                        { name: 'working', resourceDir: path.dirname(workingKernelSpec) },
                        {
                            name: '0e8519db-0895-416c-96df-fa80131ecea0',
                            resourceDir:
                                'C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0'
                        }
                    ]);
                    return Promise.resolve({ stdout: JSON.stringify(kernelSpecs) });
                } else {
                    const kernelSpecs = createKernelSpecs([
                        {
                            name: '0e8519db-0895-416c-96df-fa80131ecea0',
                            resourceDir:
                                'C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0'
                        }
                    ]);
                    return Promise.resolve({ stdout: JSON.stringify(kernelSpecs) });
                }
            }
        );
        const kernelSpecs2 = createKernelSpecs([
            { name: 'working', resourceDir: path.dirname(workingKernelSpec) },
            {
                name: '0e8519db-0895-416c-96df-fa80131ecea0',
                resourceDir:
                    'C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0'
            }
        ]);
        setupProcessServiceExec(
            service,
            workingPython.uri.fsPath,
            ['-m', 'jupyter', 'kernelspec', 'list', '--json'],
            Promise.resolve({ stdout: JSON.stringify(kernelSpecs2) })
        );
        setupProcessServiceExecWithFunc(
            service,
            workingPython.uri.fsPath,
            [
                '-m',
                'ipykernel',
                'install',
                '--user',
                '--name',
                /\w+-\w+-\w+-\w+-\w+/,
                '--display-name',
                `'Interactive'`
            ],
            () => {
                ipykernelInstallCount += 1;
                const kernelSpecs = createKernelSpecs([
                    { name: 'somename', resourceDir: path.dirname(workingKernelSpec) }
                ]);
                return Promise.resolve({ stdout: JSON.stringify(kernelSpecs) });
            }
        );
        const getServerInfoPath = path.join(
            EXTENSION_ROOT_DIR,
            'pythonFiles',
            'vscode_datascience_helpers',
            'getServerInfo.py'
        );
        setupProcessServiceExec(
            service,
            workingPython.uri.fsPath,
            [getServerInfoPath],
            Promise.resolve({ stdout: 'failure to get server infos' })
        );
        setupProcessServiceExecObservable(
            service,
            workingPython.uri.fsPath,
            ['-m', 'jupyter', 'kernelspec', 'list', '--json'],
            [],
            []
        );
        setupProcessServiceExecObservable(
            service,
            workingPython.uri.fsPath,
            [
                '-m',
                'jupyter',
                'notebook',
                '--no-browser',
                /--notebook-dir=.*/,
                /--config=.*/,
                '--NotebookApp.iopub_data_rate_limit=10000000000.0'
            ],
            [],
            notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']
        );
    }

    function setupMissingKernelProcessService(service: TypeMoq.IMock<IProcessService>, notebookStdErr?: string[]) {
        const kernelSpecs = createKernelSpecs([{ name: 'working', resourceDir: path.dirname(workingKernelSpec) }]);
        setupProcessServiceExec(
            service,
            missingKernelPython.uri.fsPath,
            ['-m', 'jupyter', 'kernelspec', 'list', '--json'],
            Promise.resolve({ stdout: JSON.stringify(kernelSpecs) })
        );
        const getServerInfoPath = path.join(
            EXTENSION_ROOT_DIR,
            'pythonFiles',
            'vscode_datascience_helpers',
            'getServerInfo.py'
        );
        setupProcessServiceExec(
            service,
            missingKernelPython.uri.fsPath,
            [getServerInfoPath],
            Promise.resolve({ stdout: 'failure to get server infos' })
        );
        setupProcessServiceExecObservable(
            service,
            missingKernelPython.uri.fsPath,
            ['-m', 'jupyter', 'kernelspec', 'list', '--json'],
            [],
            []
        );
        setupProcessServiceExecObservable(
            service,
            missingKernelPython.uri.fsPath,
            [
                '-m',
                'jupyter',
                'notebook',
                '--no-browser',
                /--notebook-dir=.*/,
                /--config=.*/,
                '--NotebookApp.iopub_data_rate_limit=10000000000.0'
            ],
            [],
            notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']
        );
    }

    function setupPathProcessService(
        jupyterPath: string,
        service: TypeMoq.IMock<IProcessService>,
        notebookStdErr?: string[]
    ) {
        const kernelSpecs = createKernelSpecs([{ name: 'working', resourceDir: path.dirname(workingKernelSpec) }]);
        setupProcessServiceExec(
            service,
            jupyterPath,
            ['kernelspec', 'list', '--json'],
            Promise.resolve({ stdout: JSON.stringify(kernelSpecs) })
        );
        setupProcessServiceExecObservable(service, jupyterPath, ['kernelspec', 'list', '--json'], [], []);
        setupProcessServiceExec(service, jupyterPath, ['--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupProcessServiceExec(
            service,
            jupyterPath,
            ['notebook', '--version'],
            Promise.resolve({ stdout: '1.1.1.1' })
        );
        setupProcessServiceExec(
            service,
            jupyterPath,
            ['kernelspec', '--version'],
            Promise.resolve({ stdout: '1.1.1.1' })
        );
        setupProcessServiceExecObservable(
            service,
            jupyterPath,
            [
                'notebook',
                '--no-browser',
                /--notebook-dir=.*/,
                /--config=.*/,
                '--NotebookApp.iopub_data_rate_limit=10000000000.0'
            ],
            [],
            notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']
        );

        // WE also check for existence with just the key jupyter
        setupProcessServiceExec(service, 'jupyter', ['--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupProcessServiceExec(service, 'jupyter', ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupProcessServiceExec(
            service,
            'jupyter',
            ['kernelspec', '--version'],
            Promise.resolve({ stdout: '1.1.1.1' })
        );
    }

    function createExecution(
        activeInterpreter: PythonEnvironment,
        notebookStdErr?: string[],
        skipSearch?: boolean
    ): HostJupyterExecution {
        return createExecutionAndReturnProcessService(activeInterpreter, notebookStdErr, skipSearch).jupyterExecution;
    }
    function createExecutionAndReturnProcessService(
        activeInterpreter: PythonEnvironment,
        notebookStdErr?: string[],
        skipSearch?: boolean,
        runInDocker?: boolean
    ): {
        executionService: IPythonExecutionService;
        jupyterExecution: HostJupyterExecution;
    } {
        // Setup defaults
        when(interpreterService.onDidChangeInterpreter).thenReturn(dummyEvent.event);
        when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
        when(interpreterService.getInterpreters(anything())).thenResolve([
            workingPython,
            missingKernelPython,
            missingNotebookPython
        ]);
        when(interpreterService.getInterpreterDetails(match('/foo/bar/python.exe'))).thenResolve(workingPython); // Mockito is stupid. Matchers have to use literals.
        when(interpreterService.getInterpreterDetails(match('/foo/baz/python.exe'))).thenResolve(missingKernelPython);
        when(interpreterService.getInterpreterDetails(match('/bar/baz/python.exe'))).thenResolve(missingNotebookPython);
        when(interpreterService.getInterpreterDetails(argThat((o) => !o.includes || !o.includes('python')))).thenReject(
            'Unknown interpreter' as any as Error
        );
        if (runInDocker) {
            when(fileSystem.readFile(anything())).thenCall((uri: Uri) => {
                if (uri.fsPath === '/proc/self/cgroup') {
                    return Promise.resolve('hello docker world');
                } else {
                    return Promise.resolve('');
                }
            });
        }
        // Create our working python and process service.
        const workingService = createTypeMoq<IPythonExecutionService>('working');
        setupWorkingPythonService(workingService, notebookStdErr, runInDocker);
        const missingKernelService = createTypeMoq<IPythonExecutionService>('missingKernel');
        setupMissingKernelPythonService(missingKernelService, notebookStdErr);
        const missingNotebookService = createTypeMoq<IPythonExecutionService>('missingNotebook');
        setupMissingNotebookPythonService(missingNotebookService);
        const missingNotebookService2 = createTypeMoq<IPythonExecutionService>('missingNotebook2');
        setupMissingNotebookPythonService(missingNotebookService2);
        const processService = createTypeMoq<IProcessService>('working process');
        setupWorkingProcessService(processService, notebookStdErr);
        setupMissingKernelProcessService(processService, notebookStdErr);
        setupPathProcessService(jupyterOnPath, processService, notebookStdErr);
        when(
            executionFactory.create(argThat((o) => o.interpreter && o.interpreter.uri === workingPython.uri))
        ).thenResolve(workingService.object);
        when(
            executionFactory.create(argThat((o) => o.interpreter && o.interpreter.uri === missingKernelPython.uri))
        ).thenResolve(missingKernelService.object);
        when(
            executionFactory.create(argThat((o) => o.interpreter && o.interpreter.uri === missingNotebookPython.uri))
        ).thenResolve(missingNotebookService.object);
        when(
            executionFactory.create(argThat((o) => o.interpreter && o.interpreter.uri === missingNotebookPython2.uri))
        ).thenResolve(missingNotebookService2.object);

        when(
            executionFactory.createDaemon(argThat((o) => o.interpreter && o.interpreter.uri === workingPython.uri))
        ).thenResolve(workingService.object as unknown as IPythonDaemonExecutionService);

        when(
            executionFactory.createDaemon(
                argThat((o) => o.interpreter && o.interpreter.uri === missingKernelPython.uri)
            )
        ).thenResolve(missingKernelService.object as unknown as IPythonDaemonExecutionService);

        when(
            executionFactory.createDaemon(
                argThat((o) => o.interpreter && o.interpreter.uri === missingNotebookPython.uri)
            )
        ).thenResolve(missingNotebookService.object as unknown as IPythonDaemonExecutionService);

        when(
            executionFactory.createDaemon(
                argThat((o) => o.interpreter && o.interpreter.uri === missingNotebookPython2.uri)
            )
        ).thenResolve(missingNotebookService2.object as unknown as IPythonDaemonExecutionService);

        let activeService = workingService;
        if (activeInterpreter === missingKernelPython) {
            activeService = missingKernelService;
        } else if (activeInterpreter === missingNotebookPython) {
            activeService = missingNotebookService;
        } else if (activeInterpreter === missingNotebookPython2) {
            activeService = missingNotebookService2;
        }
        when(executionFactory.create(argThat((o) => !o || !o.pythonPath))).thenResolve(activeService.object);
        when(
            executionFactory.createActivatedEnvironment(argThat((o) => !o || o.interpreter === activeInterpreter))
        ).thenResolve(activeService.object);
        when(
            executionFactory.createActivatedEnvironment(
                argThat((o) => o && areInterpreterPathsSame(o.interpreter.path, workingPython.uri))
            )
        ).thenResolve(workingService.object);
        when(
            executionFactory.createActivatedEnvironment(
                argThat((o) => o && areInterpreterPathsSame(o.interpreter.path, missingKernelPython.uri))
            )
        ).thenResolve(missingKernelService.object);
        when(
            executionFactory.createActivatedEnvironment(
                argThat((o) => o && areInterpreterPathsSame(o.interpreter.path, missingNotebookPython.uri))
            )
        ).thenResolve(missingNotebookService.object);
        when(
            executionFactory.createActivatedEnvironment(
                argThat((o) => o && areInterpreterPathsSame(o.interpreter.path, missingNotebookPython2.uri))
            )
        ).thenResolve(missingNotebookService2.object);
        when(processServiceFactory.create()).thenResolve(processService.object);

        // Service container needs logger, file system, and config service
        when(serviceContainer.get<IConfigurationService>(IConfigurationService)).thenReturn(instance(configService));
        when(serviceContainer.get<IFileSystem>(IFileSystem)).thenReturn(instance(fileSystem));
        when(serviceContainer.get<IWorkspaceService>(IWorkspaceService)).thenReturn(instance(workspaceService));
        when(serviceContainer.get<IApplicationShell>(IApplicationShell)).thenReturn(instance(application));
        when(configService.getSettings(anything())).thenReturn(pythonSettings);
        when(workspaceService.onDidChangeConfiguration).thenReturn(configChangeEvent.event);
        when(application.withProgress(anything(), anything())).thenCall(
            (_, cb: (_: any, token: any) => Promise<any>) => {
                return new Promise((resolve, reject) => {
                    cb({ report: noop }, new CancellationTokenSource().token).then(resolve).catch(reject);
                });
            }
        );

        // Setup default settings
        pythonSettings.assign({
            allowImportFromNotebook: true,
            jupyterLaunchTimeout: 10,
            jupyterLaunchRetries: 3,
            // eslint-disable-next-line no-template-curly-in-string
            notebookFileRoot: '${fileDirname}',
            useDefaultConfigForJupyter: true,
            jupyterInterruptTimeout: 10000,
            searchForJupyter: !skipSearch,
            showCellInputCode: true,
            allowInput: true,
            maxOutputSize: 400,
            enableScrollingForCellOutputs: true,
            errorBackgroundColor: '#FFFFFF',
            sendSelectionToInteractiveWindow: false,
            variableExplorerExclude: 'module;function;builtin_function_or_method',
            codeRegularExpression: '^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])',
            markdownRegularExpression: '^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)',
            allowLiveShare: false,
            generateSVGPlots: false,
            runStartupCommands: '',
            debugJustMyCode: true,
            variableQueries: [],
            jupyterCommandLineArguments: [],
            widgetScriptSources: [],
            interactiveWindowMode: 'single'
        });

        // Service container also needs to generate jupyter servers. However we can't use a mock as that messes up returning
        // this object from a promise
        const factory = mock<INotebookServerFactory>();
        when(factory.createNotebookServer(anything())).thenCall(
            (connection: IJupyterConnection) => new MockJupyterServer(connection)
        );

        // We also need a file system
        const tempFile = {
            dispose: () => {
                return undefined;
            },
            filePath: '/foo/bar/baz.py'
        };
        when(fileSystem.createTemporaryLocalFile(anything())).thenResolve(tempFile);
        when(fileSystem.createDirectory(anything())).thenResolve();
        when(fileSystem.delete(anything())).thenResolve();
        when(fileSystem.exists(anything())).thenCall((file: Uri) => file.fsPath === Uri.file(workingKernelSpec).fsPath);
        when(fileSystem.readFile(anything())).thenCall((uri: Uri) => {
            if (uri.fsPath === workingKernelSpec) {
                return Promise.resolve(
                    '{"display_name":"Python 3","language":"python","argv":["/foo/bar/python.exe","-m","ipykernel_launcher","-f","{connection_file}"]}'
                );
            } else {
                return Promise.resolve('');
            }
        });

        const persistentSateFactory = mock(PersistentStateFactory);
        const persistentState = mock(PersistentState);
        when(persistentState.updateValue(anything())).thenResolve();
        when(persistentSateFactory.createGlobalPersistentState(anything())).thenReturn(instance(persistentState));
        when(persistentSateFactory.createGlobalPersistentState(anything(), anything())).thenReturn(
            instance(persistentState)
        );
        when(persistentSateFactory.createWorkspacePersistentState(anything())).thenReturn(instance(persistentState));
        when(persistentSateFactory.createWorkspacePersistentState(anything(), anything())).thenReturn(
            instance(persistentState)
        );
        when(serviceContainer.get<IInterpreterService>(IInterpreterService)).thenReturn(instance(interpreterService));
        when(serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory)).thenReturn(
            instance(processServiceFactory)
        );
        when(serviceContainer.get<IEnvironmentActivationService>(IEnvironmentActivationService)).thenReturn(
            instance(activationHelper)
        );
        when(serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory)).thenReturn(
            instance(executionFactory)
        );
        const dependencyService = mock(JupyterInterpreterDependencyService);
        when(dependencyService.areDependenciesInstalled(anything(), anything())).thenCall(
            async (interpreter: PythonEnvironment) => {
                if (interpreter === missingNotebookPython) {
                    return false;
                }
                return true;
            }
        );
        when(dependencyService.getDependenciesNotInstalled(anything(), anything())).thenCall(
            async (interpreter: PythonEnvironment) => {
                if (interpreter === missingNotebookPython) {
                    return [Product.jupyter];
                }
                return [];
            }
        );
        const oldStore = mock(JupyterInterpreterOldCacheStateStore);
        when(oldStore.getCachedInterpreterPath()).thenReturn();
        const jupyterInterpreterService = mock(JupyterInterpreterService);
        when(jupyterInterpreterService.getSelectedInterpreter(anything())).thenResolve(activeInterpreter);
        const jupyterPaths = mock<JupyterPaths>();
        when(jupyterPaths.getKernelSpecTempRegistrationFolder()).thenResolve(
            Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'temp', 'jupyter', 'kernels'))
        );
        const envActivationService = mock<IEnvironmentActivationService>();
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenResolve();
        const jupyterCmdExecutionService = new JupyterInterpreterSubCommandExecutionService(
            instance(jupyterInterpreterService),
            instance(interpreterService),
            instance(dependencyService),
            instance(executionFactory),
            instance(mock<IOutputChannel>()),
            instance(jupyterPaths),
            instance(envActivationService)
        );
        when(serviceContainer.get<IJupyterSubCommandExecutionService>(IJupyterSubCommandExecutionService)).thenReturn(
            jupyterCmdExecutionService
        );
        notebookStarter = new NotebookStarter(
            jupyterCmdExecutionService,
            instance(fileSystem),
            instance(serviceContainer),
            instance(jupyterOutputChannel)
        );
        const kernelFinder = mock(LocalKernelFinder);
        const kernelSpec: IJupyterKernelSpec = {
            name: 'somename',
            executable: 'python',
            argv: ['python'],
            display_name: 'somename'
        };
        const kernelMetadata: LocalKernelConnectionMetadata = {
            kind: 'startUsingLocalKernelSpec',
            kernelSpec,
            id: getKernelId(kernelSpec)
        };
        when(kernelFinder.listKernels(anything(), anything())).thenResolve([kernelMetadata]);
        when(serviceContainer.get<NotebookStarter>(NotebookStarter)).thenReturn(notebookStarter);
        const serverFactory = mock<INotebookServerFactory>();
        const serverUriStorage = mock(JupyterServerUriStorage);
        const connection = mock<JupyterConnection>();
        return {
            executionService: activeService.object,
            jupyterExecution: new HostJupyterExecution(
                instance(interpreterService),
                disposableRegistry as unknown as any[],
                disposableRegistry,
                instance(workspaceService),
                instance(configService),
                notebookStarter,
                jupyterCmdExecutionService,
                instance(serverFactory),
                instance(serverUriStorage),
                instance(connection)
            )
        };
    }

    test('Working notebook and commands found', async () => {
        const jupyterExecutionFactory = createExecution(workingPython);

        await assert.eventually.equal(jupyterExecutionFactory.isNotebookSupported(), true, 'Notebook not supported');
        const usableInterpreter = await jupyterExecutionFactory.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable interpreter not found');
        const ui = new DisplayOptions(true);
        const token = new CancellationTokenSource();
        try {
            await assert.isFulfilled(
                jupyterExecutionFactory.connectToNotebookServer(
                    { ui, resource: undefined, localJupyter: true },
                    token.token
                ),
                'Should be able to start a server'
            );
        } finally {
            ui.dispose();
            token.dispose();
        }
    }).timeout(10000);

    test('Includes correct args for running in docker', async () => {
        const { jupyterExecution: jupyterExecutionFactory } = createExecutionAndReturnProcessService(
            workingPython,
            undefined,
            undefined,
            true
        );

        await assert.eventually.equal(jupyterExecutionFactory.isNotebookSupported(), true, 'Notebook not supported');
        const usableInterpreter = await jupyterExecutionFactory.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable interpreter not found');
        const ui = new DisplayOptions(true);
        const token = new CancellationTokenSource();
        try {
            await assert.isFulfilled(
                jupyterExecutionFactory.connectToNotebookServer(
                    { ui, resource: undefined, localJupyter: true },
                    token.token
                ),
                'Should be able to start a server'
            );
        } finally {
            ui.dispose();
            token.dispose();
        }
    }).timeout(10000);

    test('Failing notebook throws exception', async () => {
        const execution = createExecution(missingNotebookPython);
        when(interpreterService.getInterpreters(anything())).thenResolve([missingNotebookPython]);
        const ui = new DisplayOptions(true);
        const token = new CancellationTokenSource();
        try {
            await assert.isRejected(
                execution.connectToNotebookServer({ ui, resource: undefined, localJupyter: true }, token.token),
                'Running cells requires jupyter package.'
            );
        } finally {
            ui.dispose();
            token.dispose();
        }
    }).timeout(10000);

    test('Missing kernel python still finds interpreter', async () => {
        const execution = createExecution(missingKernelPython);
        when(interpreterService.getActiveInterpreter(anything())).thenResolve(missingKernelPython);
        await assert.eventually.equal(execution.isNotebookSupported(), true, 'Notebook not supported');
        const usableInterpreter = await execution.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable interpreter not found');
        if (usableInterpreter) {
            // Linter
            assert.equal(usableInterpreter.uri, missingKernelPython.uri);
            assert.equal(
                usableInterpreter.version!.major,
                missingKernelPython.version!.major,
                'Found interpreter should match on major'
            );
            assert.equal(
                usableInterpreter.version!.minor,
                missingKernelPython.version!.minor,
                'Found interpreter should match on minor'
            );
        }
    }).timeout(10000);

    test('If active interpreter does not support notebooks then no support for notebooks', async () => {
        const execution = createExecution(missingNotebookPython);
        when(interpreterService.getActiveInterpreter(anything())).thenResolve(missingNotebookPython);
        await assert.eventually.equal(execution.isNotebookSupported(), false);
    });

    test('Interpreter paths being the same', async () => {
        assert.ok(
            areInterpreterPathsSame(
                Uri.file(`/opt/hostedtoolcache/Python/3.9.12/x64/bin`),
                Uri.file(`/opt/hostedtoolcache/python/3.9.12/x64/bin`),
                getOSType(),
                true
            )
        );
    });
});
