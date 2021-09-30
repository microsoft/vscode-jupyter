// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable, named } from 'inversify';
import { DebugConfiguration, Disposable } from 'vscode';
import { ServerStatus } from '../../../datascience-ui/interactive-common/mainState';
import { IPythonDebuggerPathProvider } from '../../api/types';
import { traceInfo, traceWarning } from '../../common/logger';
import { IPlatformService } from '../../common/platform/types';
import { IConfigurationService } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { isUsingIpykernel6OrLater } from '../../debugger/jupyter/helper';
import { Identifiers } from '../constants';
import {
    ICellHashListener,
    IFileHashes,
    IJupyterConnection,
    IJupyterDebugger,
    IJupyterDebugService,
    INotebook,
    ISourceMapRequest
} from '../types';
import { JupyterDebuggerNotInstalledError } from './jupyterDebuggerNotInstalledError';
import { JupyterDebuggerRemoteNotSupported } from './jupyterDebuggerRemoteNotSupported';
import { executeSilently, getPlainTextOrStreamOutput } from './kernels/kernel';
import { IKernel } from './kernels/types';

@injectable()
export class JupyterDebugger implements IJupyterDebugger, ICellHashListener {
    private configs: Map<string, DebugConfiguration> = new Map<string, DebugConfiguration>();
    private readonly debuggerPackage: string;
    private readonly enableDebuggerCode: string;
    private readonly waitForDebugClientCode: string;
    private readonly tracingEnableCode: string;
    private readonly tracingDisableCode: string;
    private isUsingPyKernel6OrLater?: boolean;
    constructor(
        @inject(IPythonDebuggerPathProvider) private readonly debuggerPathProvider: IPythonDebuggerPathProvider,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IJupyterDebugService)
        @named(Identifiers.MULTIPLEXING_DEBUGSERVICE)
        private debugService: IJupyterDebugService,
        @inject(IPlatformService) private platform: IPlatformService
    ) {
        this.debuggerPackage = 'debugpy';
        this.enableDebuggerCode = `import debugpy;debugpy.listen(('localhost', 0))`;
        this.waitForDebugClientCode = `import debugpy;debugpy.wait_for_client()`;
        this.tracingEnableCode = `from debugpy import trace_this_thread;trace_this_thread(True)`;
        this.tracingDisableCode = `from debugpy import trace_this_thread;trace_this_thread(False)`;
    }
    public async startDebugging(kernel: IKernel): Promise<void> {
        const notebook = kernel.notebook;
        if (!notebook) {
            throw new Error('Notebook not initialized');
        }

        const settings = this.configService.getSettings(notebook.resource);
        this.isUsingPyKernel6OrLater = await isUsingIpykernel6OrLater(kernel, kernel.notebookDocument);
        return this.startDebugSession(
            (c) => this.debugService.startDebugging(undefined, c),
            notebook,
            {
                justMyCode: settings.debugJustMyCode
            },
            false
        );
    }

    public async stopDebugging(kernel: IKernel): Promise<void> {
        const notebook = kernel.notebook;
        if (!notebook) {
            return;
        }
        const config = this.configs.get(notebook.identity.toString());
        if (config) {
            traceInfo('stop debugging');

            // Tell our debug service to shutdown if possible
            this.debugService.stop();

            // Disable tracing after we disconnect because we don't want to step through this
            // code if the user was in step mode.
            if (notebook.status !== ServerStatus.Dead && notebook.status !== ServerStatus.NotStarted) {
                await executeSilently(notebook.session, this.tracingDisableCode);
            }
        }
    }

    public async hashesUpdated(hashes: IFileHashes[]): Promise<void> {
        // Make sure that we have an active debugging session at this point
        if (this.debugService.activeDebugSession) {
            await Promise.all(
                hashes.map((fileHash) => {
                    return this.debugService.activeDebugSession!.customRequest(
                        'setPydevdSourceMap',
                        this.buildSourceMap(fileHash)
                    );
                })
            );
        }
    }

    private async startDebugSession(
        startCommand: (config: DebugConfiguration) => Thenable<boolean>,
        notebook: INotebook,
        extraConfig: Partial<DebugConfiguration>,
        runByLine: boolean
    ) {
        traceInfo('start debugging');

        // Try to connect to this notebook
        const config = await this.connect(notebook, runByLine, extraConfig);
        if (config) {
            traceInfo('connected to notebook during debugging');

            await startCommand(config);

            // Force the debugger to update its list of breakpoints. This is used
            // to make sure the breakpoint list is up to date when we do code file hashes
            this.debugService.removeBreakpoints([]);

            // Wait for attach before we turn on tracing and allow the code to run, if the IDE is already attached this is just a no-op
            const importResults = await executeSilently(notebook.session, this.waitForDebugClientCode);
            if (importResults.some((item) => item.output_type === 'error')) {
                traceWarning(`${this.debuggerPackage} not found in path.`);
            } else {
                traceInfo(`import startup: ${getPlainTextOrStreamOutput(importResults)}`);
            }

            // Then enable tracing
            await executeSilently(notebook.session, this.tracingEnableCode);
        }
    }

    private async connect(
        notebook: INotebook,
        _runByLine: boolean,
        extraConfig: Partial<DebugConfiguration>
    ): Promise<DebugConfiguration | undefined> {
        // If we already have configuration, we're already attached, don't do it again.
        const key = notebook.identity.toString();
        let result = this.configs.get(key);
        if (result) {
            return {
                ...result,
                ...extraConfig
            };
        }
        traceInfo('enable debugger attach');

        // Append any specific debugger paths that we have
        await this.appendDebuggerPaths(notebook);

        // Connect local or remote based on what type of notebook we're talking to
        result = {
            type: 'python',
            name: 'IPython',
            request: 'attach',
            ...extraConfig
        };
        const connectionInfo = notebook.connection;
        if (connectionInfo && !connectionInfo.localLaunch) {
            const { host, port } = await this.connectToRemote(notebook, connectionInfo);
            result.host = host;
            result.port = port;
        } else {
            const { host, port } = await this.connectToLocal(notebook);
            result.host = host;
            result.port = port;
        }

        if (result.port) {
            this.configs.set(notebook.identity.toString(), result);

            // Sign up for any change to the kernel to delete this config.
            const disposables: Disposable[] = [];
            const clear = () => {
                this.configs.delete(key);
                disposables.forEach((d) => d.dispose());
            };
            disposables.push(notebook.onDisposed(clear));
            disposables.push(notebook.onKernelRestarted(clear));
            disposables.push(notebook.onKernelChanged(clear));
        }

        return result;
    }

    private async calculateDebuggerPathList(notebook: INotebook): Promise<string | undefined> {
        const extraPaths: string[] = [];

        // Add the settings path first as it takes precedence over the ptvsd extension path
        // eslint-disable-next-line no-multi-str
        let settingsPath = this.configService.getSettings(notebook.resource).debugpyDistPath;
        // Escape windows path chars so they end up in the source escaped
        if (settingsPath) {
            if (this.platform.isWindows) {
                settingsPath = settingsPath.replace(/\\/g, '\\\\');
            }

            extraPaths.push(settingsPath);
        }

        // For a local connection we also need will append on the path to the debugger
        // installed locally by the extension
        // Actually until this is resolved: https://github.com/microsoft/vscode-python/issues/7615, skip adding
        // this path.
        const connectionInfo = notebook.connection;
        if (connectionInfo && connectionInfo.localLaunch) {
            let localPath = await this.debuggerPathProvider.getDebuggerPath();
            if (this.platform.isWindows) {
                localPath = localPath.replace(/\\/g, '\\\\');
            }
            extraPaths.push(localPath);
        }

        if (extraPaths && extraPaths.length > 0) {
            return extraPaths.reduce((totalPath, currentPath) => {
                if (totalPath.length === 0) {
                    totalPath = `'${currentPath}'`;
                } else {
                    totalPath = `${totalPath}, '${currentPath}'`;
                }

                return totalPath;
            }, '');
        }

        return undefined;
    }

    // Append our local debugger path and debugger settings path to sys.path
    private async appendDebuggerPaths(notebook: INotebook): Promise<void> {
        const debuggerPathList = await this.calculateDebuggerPathList(notebook);

        if (debuggerPathList && debuggerPathList.length > 0) {
            const result = await executeSilently(
                notebook.session,
                `import sys\r\nsys.path.extend([${debuggerPathList}])\r\nsys.path`
            );
            traceInfo(`Appending paths: ${getPlainTextOrStreamOutput(result)}`);
        }
    }

    private buildSourceMap(fileHash: IFileHashes): ISourceMapRequest {
        const sourceMapRequest: ISourceMapRequest = { source: { path: fileHash.file }, pydevdSourceMaps: [] };
        sourceMapRequest.pydevdSourceMaps = fileHash.hashes.map((cellHash) => {
            return {
                line: cellHash.line,
                endLine: cellHash.endLine,
                runtimeSource: {
                    path: this.isUsingPyKernel6OrLater
                        ? fileHash.file
                        : `<ipython-input-${cellHash.executionCount}-${cellHash.hash}>`
                },
                runtimeLine: cellHash.runtimeLine
            };
        });

        return sourceMapRequest;
    }

    private async connectToLocal(notebook: INotebook): Promise<{ port: number; host: string }> {
        const outputs = await executeSilently(notebook.session, this.enableDebuggerCode);

        // Pull our connection info out from the cells returned by enable_attach
        if (outputs.length > 0) {
            let enableAttachString = getPlainTextOrStreamOutput(outputs);
            if (enableAttachString) {
                enableAttachString = enableAttachString.trimQuotes();

                // Important: This regex matches the format of the string returned from enable_attach. When
                // doing enable_attach remotely, make sure to print out a string in the format ('host', port)
                const debugInfoRegEx = /\('(.*?)', ([0-9]*)\)/;
                const debugInfoMatch = debugInfoRegEx.exec(enableAttachString);
                if (debugInfoMatch) {
                    return {
                        port: parseInt(debugInfoMatch[2], 10),
                        host: debugInfoMatch[1]
                    };
                }
            }
        }
        // if we cannot parse the connect information, throw so we exit out of debugging
        if (outputs.length > 0 && outputs[0].output_type === 'error') {
            const error = outputs[0] as nbformat.IError;
            throw new JupyterDebuggerNotInstalledError(this.debuggerPackage, error.ename);
        }
        throw new JupyterDebuggerNotInstalledError(
            localize.DataScience.jupyterDebuggerOutputParseError().format(this.debuggerPackage)
        );
    }

    private async connectToRemote(
        _notebook: INotebook,
        _connectionInfo: IJupyterConnection
    ): Promise<{ port: number; host: string }> {
        // We actually need a token. This isn't supported at the moment
        throw new JupyterDebuggerRemoteNotSupported();

        //         let portNumber = this.configService.getSettings().remoteDebuggerPort;
        //         if (!portNumber) {
        //             portNumber = -1;
        //         }

        //         // Loop through a bunch of ports until we find one we can use. Note how we
        //         // are connecting to '0.0.0.0' here. That's the location as far as ptvsd is concerned.
        //         const attachCode = portNumber !== -1 ?
        //             `import ptvsd
        // ptvsd.enable_attach(('0.0.0.0', ${portNumber}))
        // print("('${connectionInfo.hostName}', ${portNumber})")` :
        // eslint-disable-next-line no-multi-str
        //             `import ptvsd
        // port = ${Settings.RemoteDebuggerPortBegin}
        // attached = False
        // while not attached and port <= ${Settings.RemoteDebuggerPortEnd}:
        //     try:
        //         ptvsd.enable_attach(('0.0.0.0', port))
        //         print("('${connectionInfo.hostName}', " + str(port) + ")")
        //         attached = True
        //     except Exception as e:
        //         print("Exception: " + str(e))
        //         port +=1`;
        //         const enableDebuggerResults = await this.executeSilently(server, attachCode);

        //         // Save our connection info to this server
        //         const result = this.parseConnectInfo(enableDebuggerResults, false);

        //         // If that didn't work, throw an error so somebody can open the port
        //         if (!result) {
        //             throw new JupyterDebuggerPortNotAvailableError(portNumber, Settings.RemoteDebuggerPortBegin, Settings.RemoteDebuggerPortEnd);
        //         }

        //         // Double check, open a socket? This won't work if we're remote ourselves. Actually the debug adapter runs
        //         // from the remote machine.
        //         try {
        //             const deferred = createDeferred();
        //             const socket = net.createConnection(result.port, result.host, () => {
        //                 deferred.resolve();
        //             });
        //             socket.on('error', (err) => deferred.reject(err));
        //             socket.setTimeout(2000, () => deferred.reject(new Error('Timeout trying to ping remote debugger')));
        //             await deferred.promise;
        //             socket.end();
        //         } catch (exc) {
        //             traceWarning(`Cannot connect to remote debugger at ${result.host}:${result.port} => ${exc}`);
        //             // We can't connect. Must be a firewall issue
        //             throw new JupyterDebuggerPortBlockedError(portNumber, Settings.RemoteDebuggerPortBegin, Settings.RemoteDebuggerPortEnd);
        //         }

        //         return result;
    }
}
