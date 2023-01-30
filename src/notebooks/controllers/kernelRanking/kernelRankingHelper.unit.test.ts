// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import * as fsExtra from 'fs-extra';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { WorkspaceService } from '../../../platform/common/application/workspace.node';
import { CustomEnvironmentVariablesProvider } from '../../../platform/common/variables/customEnvironmentVariablesProvider.node';
import { InterpreterService } from '../../../platform/api/pythonApi';
import { PlatformService } from '../../../platform/common/platform/platformService.node';
import { EXTENSION_ROOT_DIR } from '../../../platform/constants.node';
import { FileSystem } from '../../../platform/common/platform/fileSystem.node';
import type { KernelSpec } from '@jupyterlab/services';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import * as platform from '../../../platform/common/utils/platform';
import { CancellationTokenSource, Disposable, EventEmitter, Memento, Uri } from 'vscode';
import {
    IDisposable,
    IExtensionContext,
    IExtensions,
    IFeaturesManager,
    KernelPickerType
} from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import {
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata
} from '../../../kernels/types';
import { JupyterPaths } from '../../../kernels/raw/finder/jupyterPaths.node';
import { ContributedLocalKernelSpecFinder } from '../../../kernels/raw/finder/contributedLocalKernelSpecFinder.node';
import { LocalKnownPathKernelSpecFinder } from '../../../kernels/raw/finder/localKnownPathKernelSpecFinder.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from '../../../kernels/raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { KernelFinder } from '../../../kernels/kernelFinder';
import { PreferredRemoteKernelIdProvider } from '../../../kernels/jupyter/preferredRemoteKernelIdProvider';
import { IJupyterServerUriStorage } from '../../../kernels/jupyter/types';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../platform/common/process/types.node';
import { getUserHomeDir } from '../../../platform/common/utils/platform.node';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelRankingHelper } from '../../../notebooks/controllers/kernelRanking/kernelRankingHelper';
import { IKernelRankingHelper } from '../../../notebooks/controllers/types';
import { RemoteKernelFinder } from '../../../kernels/jupyter/finder/remoteKernelFinder';
import { ITrustedKernelPaths } from '../../../kernels/raw/finder/types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinderOld } from '../../../kernels/raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder.old.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinderWrapper } from '../../../kernels/raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder.wrapper.node';
import { ServiceContainer } from '../../../platform/ioc/container';

[false, true].forEach((isWindows) => {
    (['Stable', 'Insiders'] as KernelPickerType[]).forEach((kernelPickerType) => {
        suite(`Kernel Ranking ${isWindows ? 'Windows' : 'Unix'} (Kernel Picker ${kernelPickerType})`, () => {
            let localKernelFinder: ContributedLocalKernelSpecFinder;
            let remoteKernelFinder: RemoteKernelFinder;
            let kernelFinder: KernelFinder;
            let interpreterService: IInterpreterService;
            let platformService: IPlatformService;
            let fs: FileSystem;
            let extensionChecker: IPythonExtensionChecker;
            const disposables: IDisposable[] = [];
            let globalSpecPath: Uri | undefined;
            let jupyterPaths: JupyterPaths;
            let preferredRemote: PreferredRemoteKernelIdProvider;
            let pythonExecService: IPythonExecutionService;
            let kernelRankHelper: IKernelRankingHelper;
            let cancelToken: CancellationTokenSource;
            let onDidChangeInterpreters: EventEmitter<void>;
            let onDidChangeInterpreter: EventEmitter<void>;
            type TestData = {
                interpreters?: (
                    | PythonEnvironment
                    | {
                          interpreter: PythonEnvironment;
                          /**
                           * These are all of the kernelspecs found within the Python environment.
                           * Could be python or non-python kernlespecs.
                           * Could be default or custom kernelspecs.
                           */
                          kernelSpecs?: KernelSpec.ISpecModel[];
                      }
                )[];
                /**
                 * All of the globally installed KernelSpecs
                 */
                globalKernelSpecs?: KernelSpec.ISpecModel[];
            };
            async function initialize(testData: TestData, activeInterpreter?: PythonEnvironment) {
                disposables.push(cancelToken);
                cancelToken = new CancellationTokenSource();
                const getRealPathStub = sinon.stub(fsExtra, 'realpath');
                getRealPathStub.returnsArg(0);
                const getOSTypeStub = sinon.stub(platform, 'getOSType');
                getOSTypeStub.returns(isWindows ? platform.OSType.Windows : platform.OSType.Linux);
                interpreterService = mock(InterpreterService);
                remoteKernelFinder = mock(RemoteKernelFinder);
                onDidChangeInterpreter = new EventEmitter<void>();
                onDidChangeInterpreters = new EventEmitter<void>();
                const onDidChangeInterpreterStatus = new EventEmitter<void>();
                const onDidRemoveInterpreter = new EventEmitter<{ id: string }>();
                disposables.push(onDidChangeInterpreter);
                disposables.push(onDidChangeInterpreters);
                disposables.push(onDidRemoveInterpreter);
                disposables.push(onDidChangeInterpreterStatus);
                when(remoteKernelFinder.listKernelsFromConnection(anything())).thenResolve([]);
                // Ensure the active Interpreter is in the list of interpreters.
                if (activeInterpreter) {
                    testData.interpreters = testData.interpreters || [];
                }
                const distinctInterpreters = new Set<PythonEnvironment>();
                (testData.interpreters || []).forEach((item) =>
                    'interpreter' in item ? distinctInterpreters.add(item.interpreter) : distinctInterpreters.add(item)
                );
                if (activeInterpreter) {
                    // Get interpreters also includes the active interpreter in the product.
                    distinctInterpreters.add(activeInterpreter);
                }
                testData.interpreters = Array.from(distinctInterpreters);
                when(interpreterService.onDidChangeInterpreter).thenReturn(onDidChangeInterpreter.event);
                when(interpreterService.onDidChangeInterpreters).thenReturn(onDidChangeInterpreters.event);
                when(interpreterService.onDidChangeStatus).thenReturn(onDidChangeInterpreterStatus.event);
                when(interpreterService.onDidRemoveInterpreter).thenReturn(onDidRemoveInterpreter.event);
                when(interpreterService.resolvedEnvironments).thenReturn(Array.from(distinctInterpreters));
                when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                when(interpreterService.getInterpreterDetails(anything())).thenResolve();
                platformService = mock(PlatformService);
                when(platformService.isWindows).thenReturn(isWindows);
                when(platformService.isLinux).thenReturn(!isWindows);
                when(platformService.isMac).thenReturn(false);
                when(platformService.homeDir).thenReturn(getUserHomeDir());
                fs = mock(FileSystem);
                when(fs.delete(anything())).thenResolve();
                when(fs.exists(anything())).thenResolve(true);
                const env = mock<IApplicationEnvironment>();
                when(env.extensionVersion).thenReturn('');
                const workspaceService = mock(WorkspaceService);
                const testWorkspaceFolder = Uri.file(path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience'));

                when(workspaceService.getWorkspaceFolderIdentifier(anything(), anything())).thenCall((_a, b) => {
                    return Promise.resolve(b);
                });
                when(workspaceService.rootFolder).thenReturn(testWorkspaceFolder);
                const envVarsProvider = mock(CustomEnvironmentVariablesProvider);
                when(envVarsProvider.getEnvironmentVariables(anything(), anything())).thenResolve({});
                const event = new EventEmitter<Uri | undefined>();
                disposables.push(event);
                when(envVarsProvider.onDidEnvironmentVariablesChange).thenReturn(event.event);
                extensionChecker = mock(PythonExtensionChecker);
                when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
                const memento = mock<Memento>();
                const context = mock<IExtensionContext>();
                when(context.extensionUri).thenReturn(Uri.file(EXTENSION_ROOT_DIR));
                when(memento.get(anything(), anything())).thenCall((_, defaultValue) => {
                    if (Array.isArray(defaultValue)) {
                        return defaultValue;
                    }
                    return false;
                });
                when(memento.update(anything(), anything())).thenResolve();
                const pythonExecFactory = mock<IPythonExecutionFactory>();
                pythonExecService = mock<IPythonExecutionService>();
                (instance(pythonExecService) as any).then = undefined;
                when(pythonExecFactory.create(anything())).thenResolve(instance(pythonExecService));
                jupyterPaths = new JupyterPaths(
                    instance(platformService),
                    instance(envVarsProvider),
                    disposables,
                    instance(memento),
                    instance(fs),
                    instance(context),
                    instance(pythonExecFactory)
                );

                const kernelSpecsBySpecFile = new Map<string, KernelSpec.ISpecModel>();
                (testData.interpreters || []).forEach((interpreter) => {
                    if ('interpreter' in interpreter) {
                        (interpreter.kernelSpecs || []).forEach((kernelSpec) => {
                            const jsonFile = path.join(
                                interpreter.interpreter.sysPrefix,
                                'share',
                                'jupyter',
                                'kernels',
                                kernelSpec.name,
                                'kernel.json'
                            );
                            kernelSpecsBySpecFile.set(jsonFile, kernelSpec);
                        });
                    }
                });
                globalSpecPath = await jupyterPaths.getKernelSpecRootPath();
                await Promise.all(
                    (testData.globalKernelSpecs || []).map(async (kernelSpec) => {
                        const jsonFile = path.join(globalSpecPath!.fsPath, kernelSpec.name, 'kernel.json');
                        kernelSpecsBySpecFile.set(jsonFile.replace(/\\/g, '/'), kernelSpec);
                    })
                );
                when(fs.readFile(anything())).thenCall((f: Uri) => {
                    // These tests run on windows & linux, hence support both paths.
                    const file = f.fsPath.replace(/\\/g, '/');
                    return kernelSpecsBySpecFile.has(file)
                        ? Promise.resolve(JSON.stringify(kernelSpecsBySpecFile.get(file)!))
                        : Promise.reject(`File "${f}" not found.`);
                });
                when(fs.searchLocal(anything(), anything(), true)).thenCall((_p, c: string, _d) => {
                    if (c === globalSpecPath?.fsPath) {
                        return (testData.globalKernelSpecs || []).map((kernelSpec) =>
                            path.join(kernelSpec.name, 'kernel.json')
                        );
                    }
                    const interpreter = (testData.interpreters || []).find((item) =>
                        'interpreter' in item ? c.includes(item.interpreter.sysPrefix) : c.includes(item.sysPrefix)
                    );
                    if (interpreter && 'interpreter' in interpreter) {
                        return (interpreter.kernelSpecs || []).map((kernelSpec) =>
                            path.join(kernelSpec.name, 'kernel.json')
                        );
                    }
                    return [];
                });
                when(fs.createDirectory(anything())).thenResolve();
                when(fs.delete(anything())).thenResolve();
                when(fs.copy(anything(), anything())).thenResolve();
                when(fs.copy(anything(), anything(), anything())).thenResolve();
                when(fs.exists(anything())).thenResolve(true);
                const nonPythonKernelSpecFinder = new LocalKnownPathKernelSpecFinder(
                    instance(fs),
                    instance(workspaceService),
                    jupyterPaths,
                    instance(extensionChecker),
                    instance(memento),
                    disposables,
                    instance(env)
                );
                when(memento.get('LOCAL_KERNEL_SPEC_CONNECTIONS_CACHE_KEY_V2', anything())).thenReturn([]);
                when(memento.get('JUPYTER_GLOBAL_KERNELSPECS_V2', anything())).thenReturn([]);
                when(memento.update('JUPYTER_GLOBAL_KERNELSPECS_V2', anything())).thenResolve();

                preferredRemote = mock(PreferredRemoteKernelIdProvider);
                const uriStorage = mock<IJupyterServerUriStorage>();
                when(uriStorage.isLocalLaunch).thenReturn(true);
                const onDidChangeEvent = new EventEmitter<void>();
                disposables.push(onDidChangeEvent);
                when(uriStorage.onDidChangeConnectionType).thenReturn(onDidChangeEvent.event);

                const extensions = mock<IExtensions>();
                const trustedKernels = mock<ITrustedKernelPaths>();
                when(trustedKernels.isTrusted(anything())).thenReturn(true);
                const featuresManager = mock<IFeaturesManager>();
                when(featuresManager.features).thenReturn({ kernelPickerType });
                kernelFinder = new KernelFinder([]);

                const serviceContainer = mock<ServiceContainer>();
                const iocStub = sinon.stub(ServiceContainer, 'instance').get(() => instance(serviceContainer));
                disposables.push(new Disposable(() => iocStub.restore()));
                when(
                    serviceContainer.get<LocalPythonAndRelatedNonPythonKernelSpecFinder>(
                        LocalPythonAndRelatedNonPythonKernelSpecFinder
                    )
                ).thenCall(
                    () =>
                        new LocalPythonAndRelatedNonPythonKernelSpecFinder(
                            instance(interpreterService),
                            instance(fs),
                            instance(workspaceService),
                            jupyterPaths,
                            instance(extensionChecker),
                            nonPythonKernelSpecFinder,
                            instance(memento),
                            disposables,
                            instance(env),
                            instance(trustedKernels)
                        )
                );
                when(
                    serviceContainer.get<LocalPythonAndRelatedNonPythonKernelSpecFinderOld>(
                        LocalPythonAndRelatedNonPythonKernelSpecFinderOld
                    )
                ).thenCall(
                    () =>
                        new LocalPythonAndRelatedNonPythonKernelSpecFinderOld(
                            instance(interpreterService),
                            instance(fs),
                            instance(workspaceService),
                            jupyterPaths,
                            instance(extensionChecker),
                            nonPythonKernelSpecFinder,
                            instance(memento),
                            disposables,
                            instance(env),
                            instance(trustedKernels)
                        )
                );
                const pythonKernelFinderWrapper = new LocalPythonAndRelatedNonPythonKernelSpecFinderWrapper(
                    disposables,
                    instance(featuresManager)
                );
                localKernelFinder = new ContributedLocalKernelSpecFinder(
                    nonPythonKernelSpecFinder,
                    pythonKernelFinderWrapper,
                    kernelFinder,
                    [],
                    instance(extensionChecker),
                    instance(interpreterService),
                    instance(extensions)
                );
                localKernelFinder.activate();
                nonPythonKernelSpecFinder.activate();
                pythonKernelFinderWrapper.activate();

                kernelRankHelper = new KernelRankingHelper(instance(preferredRemote));
            }
            teardown(() => {
                disposeAllDisposables(disposables);
                sinon.restore();
            });

            test('isExactMatch LiveID match is an exact match', async () => {
                const testData: TestData = {};
                await initialize(testData);
                const nbUri = Uri.file('test.ipynb');
                const activeID = 'activeid';

                // Live kernel spec
                const liveSpec = LiveRemoteKernelConnectionMetadata.create({
                    kernelModel: { id: activeID } as any,
                    baseUrl: '',
                    id: activeID,
                    serverId: ''
                });

                // Set up the preferred remote id
                when(preferredRemote.getPreferredRemoteKernelId(anything())).thenResolve(activeID);
                const isExactMatch = await kernelRankHelper.isExactMatch(nbUri, liveSpec, {
                    language_info: { name: PYTHON_LANGUAGE },
                    orig_nbformat: 4
                });
                assert.isTrue(isExactMatch);
            });
            test('isExactMatch kernelspec needed for exact match', async () => {
                const testData: TestData = {};
                await initialize(testData);
                const nbUri = Uri.file('test.ipynb');

                const isExactMatch = await kernelRankHelper.isExactMatch(
                    nbUri,
                    LocalKernelSpecConnectionMetadata.create({ id: 'hi', kernelSpec: {} as any }),
                    {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4
                    }
                );
                assert.isFalse(isExactMatch);
            });
            test('isExactMatch interpreter hash matches default name matches', async () => {
                const testData: TestData = {};
                await initialize(testData);

                const nbUri = Uri.file('test.ipynb');

                const isExactMatch = await kernelRankHelper.isExactMatch(
                    nbUri,
                    LocalKernelSpecConnectionMetadata.create({
                        id: '',
                        kernelSpec: {
                            argv: [],
                            display_name: 'display_namea',
                            name: 'python3', // default name here
                            executable: 'path'
                        },
                        interpreter: { uri: Uri.file('a') } as any
                    }),
                    {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4,
                        interpreter: { hash: '6a50dc8584134c7de537c0052ff6d236bf874355e050c90523e0c5ff2a543a28' },
                        kernelspec: { name: 'python3', display_name: 'display_namea' }
                    }
                );
                assert.isTrue(isExactMatch);
            });
            test('isExactMatch vscode interpreter hash matches default name matches', async () => {
                const testData: TestData = {};
                await initialize(testData);

                const nbUri = Uri.file('test.ipynb');

                const isExactMatch = await kernelRankHelper.isExactMatch(
                    nbUri,
                    LocalKernelSpecConnectionMetadata.create({
                        id: '',
                        kernelSpec: {
                            argv: [],
                            display_name: 'display_namea',
                            name: 'python3', // default name here
                            executable: 'path'
                        },
                        interpreter: { uri: Uri.file('a') } as any
                    }),
                    {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4,
                        vscode: {
                            interpreter: { hash: '6a50dc8584134c7de537c0052ff6d236bf874355e050c90523e0c5ff2a543a28' }
                        },
                        kernelspec: { name: 'python3', display_name: 'display_namea' }
                    }
                );
                assert.isTrue(isExactMatch);
            });
            test('isExactMatch interpreter hash matches non-default name matches', async () => {
                const testData: TestData = {};
                await initialize(testData);

                const nbUri = Uri.file('test.ipynb');

                const isExactMatch = await kernelRankHelper.isExactMatch(
                    nbUri,
                    LocalKernelSpecConnectionMetadata.create({
                        id: '',
                        kernelSpec: {
                            argv: [],
                            display_name: 'display_namea',
                            name: 'namea', // Non default name
                            executable: 'path'
                        },
                        interpreter: { uri: Uri.file('a') } as any
                    }),
                    {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4,
                        interpreter: { hash: '6a50dc8584134c7de537c0052ff6d236bf874355e050c90523e0c5ff2a543a28' },
                        kernelspec: { name: 'namea', display_name: 'display_namea' }
                    }
                );
                assert.isTrue(isExactMatch);
            });
            test('isExactMatch vscode interpreter hash matches non-default name matches', async () => {
                const testData: TestData = {};
                await initialize(testData);

                const nbUri = Uri.file('test.ipynb');

                const isExactMatch = await kernelRankHelper.isExactMatch(
                    nbUri,
                    LocalKernelSpecConnectionMetadata.create({
                        id: '',
                        kernelSpec: {
                            argv: [],
                            display_name: 'display_namea',
                            name: 'namea', // Non default name
                            executable: 'path'
                        },
                        interpreter: { uri: Uri.file('a') } as any
                    }),
                    {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4,
                        vscode: {
                            interpreter: { hash: '6a50dc8584134c7de537c0052ff6d236bf874355e050c90523e0c5ff2a543a28' }
                        },
                        kernelspec: { name: 'namea', display_name: 'display_namea' }
                    }
                );
                assert.isTrue(isExactMatch);
            });
            test('isExactMatch non-default name matches w/o interpreter', async () => {
                const testData: TestData = {};
                await initialize(testData);

                const nbUri = Uri.file('test.ipynb');

                const isExactMatch = await kernelRankHelper.isExactMatch(
                    nbUri,
                    LocalKernelSpecConnectionMetadata.create({
                        id: '',
                        kernelSpec: {
                            argv: [],
                            display_name: 'display_namea',
                            name: 'namea',
                            executable: 'path'
                        }
                    }),
                    {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4,
                        kernelspec: { name: 'namea', display_name: 'display_namea' }
                    }
                );
                assert.isTrue(isExactMatch);
            });
            test('isExactMatch default name does not match w/o interpreter', async () => {
                const testData: TestData = {};
                await initialize(testData);

                const nbUri = Uri.file('test.ipynb');

                const isExactMatch = await kernelRankHelper.isExactMatch(
                    nbUri,
                    LocalKernelSpecConnectionMetadata.create({
                        id: '',
                        kernelSpec: {
                            argv: [],
                            display_name: 'display_namea',
                            name: 'python3', // default name here
                            executable: 'path'
                        }
                    }),
                    {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4,
                        kernelspec: { name: 'python3', display_name: 'display_namea' }
                    }
                );
                assert.isFalse(isExactMatch);
            });
        });
    });
});

export function takeTopRankKernel(
    rankedKernels: KernelConnectionMetadata[] | undefined
): KernelConnectionMetadata | undefined {
    if (rankedKernels && rankedKernels.length) {
        return rankedKernels[rankedKernels.length - 1];
    }
}
