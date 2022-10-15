// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable, named } from 'inversify';
import * as path from '../../platform/vscode-path/path';
import * as uriPath from '../../platform/vscode-path/resources';

import { DebugAdapterTracker, Disposable, Event, EventEmitter } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { convertDebugProtocolVariableToIJupyterVariable, DataViewableTypes } from '../../kernels/variables/helpers';
import { parseDataFrame } from '../../kernels/variables/pythonVariableRequester';
import {
    IConditionalJupyterVariables,
    IJupyterVariable,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse
} from '../../kernels/variables/types';
import { IDebugService, IVSCodeNotebook } from '../../platform/common/application/types';
import { Identifiers } from '../../platform/common/constants';
import {
    IConfigurationService,
    IDataFrameScriptGenerator,
    IVariableScriptGenerator,
    Resource
} from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { traceError, traceVerbose } from '../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { IJupyterDebugService, INotebookDebuggingManager, KernelDebugMode } from './debuggingTypes';
import { DebugLocationTracker } from './debugLocationTracker';

const KnownExcludedVariables = new Set<string>(['In', 'Out', 'exit', 'quit']);
const MaximumRowChunkSizeForDebugger = 100;

/**
 * Class responsible for computing variables while debugging.
 */
@injectable()
export class DebuggerVariables
    extends DebugLocationTracker
    implements IConditionalJupyterVariables, DebugAdapterTracker
{
    static dataFrameScriptContents?: string;
    private refreshEventEmitter = new EventEmitter<void>();
    private lastKnownVariables: IJupyterVariable[] = [];
    private importedGetVariableInfoScriptsIntoKernel = new Set<string>();
    private watchedNotebooks = new Map<string, Disposable[]>();
    private debuggingStarted = false;
    private currentVariablesReference = 0;
    private currentSeqNumsForVariables = new Set<Number>();

    constructor(
        @inject(IJupyterDebugService) @named(Identifiers.MULTIPLEXING_DEBUGSERVICE) private debugService: IDebugService,
        @inject(INotebookDebuggingManager) private readonly debuggingManager: INotebookDebuggingManager,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IVariableScriptGenerator) private readonly varScriptGenerator: IVariableScriptGenerator,
        @inject(IDataFrameScriptGenerator) private readonly dfScriptGenerator: IDataFrameScriptGenerator,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider
    ) {
        super(undefined);
        this.debuggingManager.onDoneDebugging(() => this.refreshEventEmitter.fire(), this);
    }

    public get refreshRequired(): Event<void> {
        return this.refreshEventEmitter.event;
    }

    public get active(): boolean {
        return (
            (this.debugService.activeDebugSession !== undefined || this.activeNotebookIsDebugging()) &&
            this.debuggingStarted
        );
    }

    // IJupyterVariables implementation
    public async getVariables(request: IJupyterVariablesRequest, kernel?: IKernel): Promise<IJupyterVariablesResponse> {
        // Listen to notebook events if we haven't already
        if (kernel) {
            this.watchKernel(kernel);
        }
        const execution = kernel && this.kernelProvider.getKernelExecution(kernel);
        const result: IJupyterVariablesResponse = {
            executionCount: execution ? execution.executionCount : request.executionCount,
            pageStartIndex: 0,
            pageResponse: [],
            totalCount: 0,
            refreshCount: request.refreshCount
        };

        if (this.active) {
            type SortableColumn = 'name' | 'type';
            const sortColumn = request.sortColumn as SortableColumn;
            const comparer = (a: IJupyterVariable, b: IJupyterVariable): number => {
                // In case it is undefined or null
                const aColumn = a[sortColumn] ? a[sortColumn] : '';
                const bColumn = b[sortColumn] ? b[sortColumn] : '';

                if (request.sortAscending) {
                    return aColumn.localeCompare(bColumn, undefined, { sensitivity: 'base' });
                } else {
                    return bColumn.localeCompare(aColumn, undefined, { sensitivity: 'base' });
                }
            };
            this.lastKnownVariables.sort(comparer);

            const startPos = request.startIndex ? request.startIndex : 0;
            const chunkSize = request.pageSize ? request.pageSize : MaximumRowChunkSizeForDebugger;
            result.pageStartIndex = startPos;

            // Do one at a time. All at once doesn't work as they all have to wait for each other anyway
            for (let i = startPos; i < startPos + chunkSize && i < this.lastKnownVariables.length; i += 1) {
                const fullVariable = !this.lastKnownVariables[i].truncated
                    ? this.lastKnownVariables[i]
                    : await this.getFullVariable(this.lastKnownVariables[i]);
                this.lastKnownVariables[i] = fullVariable;
                result.pageResponse.push(fullVariable);
            }
            result.totalCount = this.lastKnownVariables.length;
        }

        return result;
    }

    public async getMatchingVariable(name: string, kernel?: IKernel): Promise<IJupyterVariable | undefined> {
        if (this.active) {
            // Note, full variable results isn't necessary for this call. It only really needs the variable value.
            const result = this.lastKnownVariables.find((v) => v.name === name);
            if (result && kernel?.resourceUri && uriPath.extname(kernel?.resourceUri).toLowerCase() === '.ipynb') {
                sendTelemetryEvent(Telemetry.RunByLineVariableHover);
            }
            return result;
        }
    }

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        kernel?: IKernel,
        sliceExpression?: string,
        isRefresh?: boolean
    ): Promise<IJupyterVariable> {
        if (!this.active) {
            // No active server just return the unchanged target variable
            return targetVariable;
        }
        if (isRefresh) {
            targetVariable = await this.getFullVariable(targetVariable);
        }
        // Listen to notebook events if we haven't already
        if (kernel) {
            this.watchKernel(kernel);
        }

        let expression = targetVariable.name;
        if (sliceExpression) {
            expression = `${targetVariable.name}${sliceExpression}`;
        }

        // Then eval calling the main function with our target variable
        const { cleanupCode, initializeCode, code } = await this.dfScriptGenerator.generateCodeToGetDataFrameInfo({
            isDebugging: true,
            variableName: expression
        });
        const results = await this.evaluate({
            code,
            cleanupCode,
            initializeCode,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            frameId: (targetVariable as any).frameId
        });

        const notebook = kernel?.notebook;
        let fileName = notebook ? path.basename(notebook.uri.path) : '';
        if (!fileName && this.debugLocation?.fileName) {
            fileName = path.basename(this.debugLocation.fileName);
        }
        // Results should be the updated variable.
        return results
            ? {
                  ...targetVariable,
                  ...JSON.parse(results.result),
                  maximumRowChunkSize: MaximumRowChunkSizeForDebugger,
                  fileName
              }
            : targetVariable;
    }

    public async getDataFrameRows(
        targetVariable: IJupyterVariable,
        start: number,
        end: number,
        kernel?: IKernel,
        sliceExpression?: string
    ): Promise<{ data: Record<string, unknown>[] }> {
        // Developer error. The debugger cannot eval more than 100 rows at once.
        if (end - start > MaximumRowChunkSizeForDebugger) {
            throw new Error(`Debugger cannot provide more than ${MaximumRowChunkSizeForDebugger} rows at once`);
        }

        // Run the get dataframe rows script
        if (!this.debugService.activeDebugSession || targetVariable.columns === undefined) {
            // No active server just return no rows
            return { data: [] };
        }
        // Listen to notebook events if we haven't already
        if (kernel) {
            this.watchKernel(kernel);
        }

        let expression = targetVariable.name;
        if (sliceExpression) {
            expression = `${targetVariable.name}${sliceExpression}`;
        }

        const { cleanupCode, initializeCode, code } = await this.dfScriptGenerator.generateCodeToGetDataFrameRows({
            isDebugging: true,
            variableName: expression,
            startIndex: start,
            endIndex: end
        });
        const results = await this.evaluate({
            code,
            cleanupCode,
            initializeCode,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            frameId: (targetVariable as any).frameId
        });
        return parseDataFrame(JSON.parse(results.result));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public override onWillReceiveMessage(message: any) {
        super.onWillReceiveMessage(message);
        if (
            message.type === 'request' &&
            message.command === 'variables' &&
            message.arguments &&
            this.currentVariablesReference === message.arguments.variablesReference
        ) {
            this.currentSeqNumsForVariables.add(message.seq);
        }
    }

    // This special DebugAdapterTracker function listens to messages sent from the debug adapter to VS Code
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public override onDidSendMessage(message: any) {
        super.onDidSendMessage(message);
        // When the initialize response comes back, indicate we have started.
        if (message.type === 'response' && message.command === 'initialize') {
            this.debuggingStarted = true;
        } else if (message.type === 'event' && message.event === 'stopped' && this.activeNotebookIsDebugging()) {
            this.handleNotebookVariables(message as DebugProtocol.StoppedEvent).ignoreErrors();
        } else if (message.type === 'response' && message.command === 'scopes' && message.body && message.body.scopes) {
            const response = message as DebugProtocol.ScopesResponse;

            // Keep track of variablesReference because "hover" requests also try to update variables
            const newVariablesReference = response.body.scopes[0].variablesReference;
            if (newVariablesReference !== this.currentVariablesReference) {
                this.currentVariablesReference = newVariablesReference;
                this.currentSeqNumsForVariables.clear();
            }
        } else if (message.type === 'response' && message.command === 'variables' && message.body) {
            if (this.currentSeqNumsForVariables.has(message.request_seq)) {
                // If using the interactive debugger, update our variables.
                // TODO: Figure out what resource to use

                // Only update variables if it came from a "scopes" command and not a "hover"
                // 1. Scopes command will come first with a variablesReference number
                // 2. onWillReceiveMessage will have that variablesReference and
                // will request for variables with a seq number
                // 3. We only updateVariables if the seq number is one of the sequence numbers that
                // came with the most recent 'scopes' variablesReference
                this.updateVariables(undefined, message as DebugProtocol.VariablesResponse);
            }

            // Monkey patch for any sequence number so that expanded variables can get the "Show in Data Viewer" option
            this.monkeyPatchDataViewableVariables(message);
        } else if (message.type === 'event' && message.event === 'terminated') {
            // When the debugger exits, make sure the variables are cleared
            this.lastKnownVariables = [];
            this.topMostFrameId = 0;
            this.debuggingStarted = false;
            this.refreshEventEmitter.fire();
            const key = this.debugService.activeDebugSession?.id;
            if (key) {
                this.importedGetVariableInfoScriptsIntoKernel.delete(key);
            }
        }
    }

    private watchKernel(kernel: IKernel) {
        const key = kernel.notebook?.uri.toString();
        if (key && !this.watchedNotebooks.has(key)) {
            const disposables: Disposable[] = [];
            disposables.push(kernel.onRestarted(this.resetImport.bind(this, key)));
            disposables.push(
                kernel.onDisposed(() => {
                    this.resetImport(key);
                    disposables.forEach((d) => d.dispose());
                    this.watchedNotebooks.delete(key);
                })
            );
            this.watchedNotebooks.set(key, disposables);
        }
    }

    private resetImport(key: string) {
        this.importedGetVariableInfoScriptsIntoKernel.delete(key);
    }

    private async evaluate({
        code,
        cleanupCode,
        frameId,
        initializeCode
    }: {
        code: string;
        initializeCode?: string;
        cleanupCode?: string;
        frameId?: number;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }): Promise<any> {
        if (this.debugService.activeDebugSession) {
            frameId = this.topMostFrameId || frameId;
            const defaultEvalOptions = {
                frameId,
                context: 'repl',
                format: { rawString: true }
            };
            traceVerbose(`Evaluating in debugger : ${this.debugService.activeDebugSession.id}: ${code}`);
            try {
                if (initializeCode) {
                    await this.debugService.activeDebugSession.customRequest('evaluate', {
                        ...defaultEvalOptions,
                        expression: initializeCode
                    });
                }
                const results = await this.debugService.activeDebugSession.customRequest('evaluate', {
                    ...defaultEvalOptions,
                    expression: code
                });
                if (results && results.result !== 'None') {
                    return results;
                } else {
                    traceError(`Cannot evaluate ${code}`);
                    return undefined;
                }
            } finally {
                if (cleanupCode) {
                    await this.debugService.activeDebugSession.customRequest('evaluate', {
                        ...defaultEvalOptions,
                        expression: cleanupCode
                    });
                }
            }
        }
        throw Error('Debugger is not active, cannot evaluate.');
    }
    public async getFullVariable(variable: IJupyterVariable): Promise<IJupyterVariable> {
        // Then eval calling the variable info function with our target variable
        const { initializeCode, code, cleanupCode } = await this.varScriptGenerator.generateCodeToGetVariableInfo({
            isDebugging: true,
            variableName: variable.name
        });
        const results = await this.evaluate({
            code,
            initializeCode,
            cleanupCode,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            frameId: (variable as any).frameId
        });
        if (results && results.result) {
            // Results should be the updated variable.
            return {
                ...variable,
                truncated: false,
                ...JSON.parse(results.result)
            };
        } else {
            // If no results, just return current value. Better than nothing.
            return variable;
        }
    }

    private monkeyPatchDataViewableVariables(variablesResponse: DebugProtocol.VariablesResponse) {
        variablesResponse.body.variables.forEach((v) => {
            if (v.type && DataViewableTypes.has(v.type)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (v as any).__vscodeVariableMenuContext = 'viewableInDataViewer';
            }
        });
    }

    private updateVariables(resource: Resource, variablesResponse: DebugProtocol.VariablesResponse) {
        const exclusionList = this.configService.getSettings(resource).variableExplorerExclude
            ? this.configService.getSettings().variableExplorerExclude?.split(';')
            : [];

        const allowedVariables = variablesResponse.body.variables.filter((v) => {
            if (!v.name || !v.type || !v.value) {
                return false;
            }
            if (exclusionList && exclusionList.includes(v.type)) {
                return false;
            }
            if (v.name.startsWith('_')) {
                return false;
            }
            if (KnownExcludedVariables.has(v.name)) {
                return false;
            }
            if (v.type === 'NoneType') {
                return false;
            }
            return true;
        });

        this.lastKnownVariables = allowedVariables.map((v) => {
            return convertDebugProtocolVariableToIJupyterVariable(v);
        });

        this.refreshEventEmitter.fire();
    }

    private activeNotebookIsDebugging(): boolean {
        const activeNotebook = this.vscNotebook.activeNotebookEditor;
        return !!activeNotebook && this.debuggingManager.isDebugging(activeNotebook.notebook);
    }

    // This handles all the debug session calls, variable handling, and refresh calls needed for notebook debugging
    private async handleNotebookVariables(stoppedMessage: DebugProtocol.StoppedEvent): Promise<void> {
        const doc = this.vscNotebook.activeNotebookEditor?.notebook;
        const threadId = stoppedMessage.body.threadId;

        if (doc) {
            const session = this.debuggingManager.getDebugSession(doc);
            if (session) {
                // Call stack trace
                const stResponse: DebugProtocol.StackTraceResponse['body'] = await session.customRequest('stackTrace', {
                    threadId,
                    startFrame: 0,
                    levels: 1
                });

                //  Call scopes
                if (stResponse && stResponse.stackFrames[0]) {
                    const sf = stResponse.stackFrames[0];
                    const mode = this.debuggingManager.getDebugMode(doc);
                    let scopesResponse: DebugProtocol.ScopesResponse['body'] | undefined;

                    if (mode === KernelDebugMode.RunByLine) {
                        // Only call scopes (and variables) if we are stopped on the cell we are executing
                        const cell = this.debuggingManager.getDebugCell(doc);
                        if (sf.source && cell && sf.source.path === cell.document.uri.toString()) {
                            scopesResponse = await session.customRequest('scopes', { frameId: sf.id });
                        }
                    } else {
                        // Only call scopes (and variables) if we are stopped on the notebook we are executing
                        const docURI = path.basename(doc.uri.toString());
                        if (sf.source && sf.source.path && sf.source.path.includes(docURI)) {
                            scopesResponse = await session.customRequest('scopes', { frameId: sf.id });
                        }
                    }

                    // Call variables
                    if (scopesResponse) {
                        scopesResponse.scopes.forEach((scope: DebugProtocol.Scope) => {
                            session
                                .customRequest('variables', { variablesReference: scope.variablesReference })
                                .then(noop, noop);
                        });

                        this.refreshEventEmitter.fire();
                    }
                }
            }
        }
    }
}
