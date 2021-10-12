// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';
import * as path from 'path';

import { DebugAdapterTracker, Disposable, Event, EventEmitter } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IDebugService, IVSCodeNotebook } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { IConfigurationService, Resource } from '../../common/types';
import { IDebuggingManager, KernelDebugMode } from '../../debugger/types';
import { sendTelemetryEvent } from '../../telemetry';
import { DataFrameLoading, GetVariableInfo, Identifiers, Telemetry } from '../constants';
import { DebugLocationTracker } from '../debugLocationTracker';
import {
    IConditionalJupyterVariables,
    IJupyterDebugService,
    IJupyterVariable,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse
} from '../types';
import { IKernel } from './kernels/types';

const DataViewableTypes: Set<string> = new Set<string>([
    'DataFrame',
    'list',
    'dict',
    'ndarray',
    'Series',
    'Tensor',
    'EagerTensor',
    'DataArray'
]);
const KnownExcludedVariables = new Set<string>(['In', 'Out', 'exit', 'quit']);
const MaximumRowChunkSizeForDebugger = 100;

@injectable()
export class DebuggerVariables extends DebugLocationTracker
    implements IConditionalJupyterVariables, DebugAdapterTracker {
    private refreshEventEmitter = new EventEmitter<void>();
    private lastKnownVariables: IJupyterVariable[] = [];
    private importedDataFrameScriptsIntoKernel = new Set<string>();
    private importedGetVariableInfoScriptsIntoKernel = new Set<string>();
    private watchedNotebooks = new Map<string, Disposable[]>();
    private debuggingStarted = false;
    private currentVariablesReference = 0;
    private currentSeqNumsForVariables = new Set<Number>();

    constructor(
        @inject(IJupyterDebugService) @named(Identifiers.MULTIPLEXING_DEBUGSERVICE) private debugService: IDebugService,
        @inject(IDebuggingManager) private readonly debuggingManager: IDebuggingManager,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook
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

        const result: IJupyterVariablesResponse = {
            executionCount: request.executionCount,
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
            if (result && kernel?.notebookDocument.uri.fsPath.endsWith('.ipynb')) {
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

        // See if we imported or not into the kernel our special function
        await this.importDataFrameScripts();

        let expression = targetVariable.name;
        if (sliceExpression) {
            expression = `${targetVariable.name}${sliceExpression}`;
        }

        // Then eval calling the main function with our target variable
        const results = await this.evaluate(
            `${DataFrameLoading.DataFrameInfoImportFunc}(${expression})`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (targetVariable as any).frameId
        );

        let fileName = kernel ? path.basename(kernel.notebookDocument.uri.fsPath) : '';
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
    ): Promise<{}> {
        // Developer error. The debugger cannot eval more than 100 rows at once.
        if (end - start > MaximumRowChunkSizeForDebugger) {
            throw new Error(`Debugger cannot provide more than ${MaximumRowChunkSizeForDebugger} rows at once`);
        }

        // Run the get dataframe rows script
        if (!this.debugService.activeDebugSession || targetVariable.columns === undefined) {
            // No active server just return no rows
            return {};
        }
        // Listen to notebook events if we haven't already
        if (kernel) {
            this.watchKernel(kernel);
        }

        let expression = targetVariable.name;
        if (sliceExpression) {
            expression = `${targetVariable.name}${sliceExpression}`;
        }

        // See if we imported or not into the kernel our special function
        await this.importDataFrameScripts();

        const results = await this.evaluate(
            `${DataFrameLoading.DataFrameRowImportFunc}(${expression}, ${start}, ${end})`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (targetVariable as any).frameId
        );
        return JSON.parse(results.result);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public onWillReceiveMessage(message: any) {
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
    public onDidSendMessage(message: any) {
        super.onDidSendMessage(message);
        // When the initialize response comes back, indicate we have started.
        if (message.type === 'response' && message.command === 'initialize') {
            this.debuggingStarted = true;
        } else if (message.type === 'event' && message.event === 'stopped' && this.activeNotebookIsDebugging()) {
            void this.handleNotebookVariables(message as DebugProtocol.StoppedEvent);
        } else if (message.type === 'response' && message.command === 'scopes' && message.body && message.body.scopes) {
            const response = message as DebugProtocol.ScopesResponse;

            // Keep track of variablesReference because "hover" requests also try to update variables
            const newVariablesReference = response.body.scopes[0].variablesReference;
            if (newVariablesReference !== this.currentVariablesReference) {
                this.currentVariablesReference = newVariablesReference;
                this.currentSeqNumsForVariables.clear();
            }
        } else if (
            message.type === 'response' &&
            message.command === 'variables' &&
            message.body &&
            this.currentSeqNumsForVariables.has(message.request_seq)
        ) {
            // If using the interactive debugger, update our variables.
            // eslint-disable-next-line
            // TODO: Figure out what resource to use

            // Only update variables if it came from a "scopes" command and not a "hover"
            // 1. Scopes command will come first with a variablesReference number
            // 2. onWillReceiveMessage will have that variablesReference and
            // will request for variables with a seq number
            // 3. We only updateVariables if the seq number is one of the sequence numbers that
            // came with the most recent 'scopes' variablesReference

            this.updateVariables(undefined, message as DebugProtocol.VariablesResponse);
            this.monkeyPatchDataViewableVariables(message);
        } else if (message.type === 'event' && message.event === 'terminated') {
            // When the debugger exits, make sure the variables are cleared
            this.lastKnownVariables = [];
            this.topMostFrameId = 0;
            this.debuggingStarted = false;
            this.refreshEventEmitter.fire();
            const key = this.debugService.activeDebugSession?.id;
            if (key) {
                this.importedDataFrameScriptsIntoKernel.delete(key);
                this.importedGetVariableInfoScriptsIntoKernel.delete(key);
            }
        }
    }

    private watchKernel(kernel: IKernel) {
        const key = kernel.notebookDocument.uri.toString();
        if (!this.watchedNotebooks.has(key)) {
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
        this.importedDataFrameScriptsIntoKernel.delete(key);
        this.importedGetVariableInfoScriptsIntoKernel.delete(key);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async evaluate(code: string, frameId?: number): Promise<any> {
        if (this.debugService.activeDebugSession) {
            const results = await this.debugService.activeDebugSession.customRequest('evaluate', {
                expression: code,
                frameId: this.topMostFrameId || frameId,
                context: 'repl',
                format: { rawString: true }
            });
            if (results && results.result !== 'None') {
                return results;
            } else {
                traceError(`Cannot evaluate ${code}`);
                return undefined;
            }
        }
        throw Error('Debugger is not active, cannot evaluate.');
    }

    private async importDataFrameScripts(): Promise<void> {
        try {
            // Run our dataframe scripts only once per session because they're slow
            const key = this.debugService.activeDebugSession?.id;
            if (key && !this.importedDataFrameScriptsIntoKernel.has(key)) {
                await this.evaluate(DataFrameLoading.DataFrameSysImport);
                this.importedDataFrameScriptsIntoKernel.add(key);
            }
        } catch (exc) {
            traceError('Error attempting to import in debugger', exc);
        }
    }

    private async importGetVariableInfoScripts(): Promise<void> {
        try {
            // Run our variable info scripts only once per session because they're slow
            const key = this.debugService.activeDebugSession?.id;
            if (key && !this.importedGetVariableInfoScriptsIntoKernel.has(key)) {
                await this.evaluate(GetVariableInfo.GetVariableInfoSysImport);
                this.importedGetVariableInfoScriptsIntoKernel.add(key);
            }
        } catch (exc) {
            traceError('Error attempting to import in debugger', exc);
        }
    }

    public async getFullVariable(variable: IJupyterVariable): Promise<IJupyterVariable> {
        // See if we imported or not into the kernel our special function
        await this.importGetVariableInfoScripts();

        // Then eval calling the variable info function with our target variable
        const results = await this.evaluate(
            `${GetVariableInfo.VariableInfoImportFunc}(${variable.name})`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (variable as any).frameId
        );
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
        return !!activeNotebook && this.debuggingManager.isDebugging(activeNotebook.document);
    }

    // This handles all the debug session calls, variable handling, and refresh calls needed for notebook debugging
    private async handleNotebookVariables(stoppedMessage: DebugProtocol.StoppedEvent): Promise<void> {
        const doc = this.vscNotebook.activeNotebookEditor?.document;
        const threadId = stoppedMessage.body.threadId;

        if (doc) {
            const session = await this.debuggingManager.getDebugSession(doc);
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
                            void session.customRequest('variables', { variablesReference: scope.variablesReference });
                        });

                        this.refreshEventEmitter.fire();
                    }
                }
            }
        }
    }
}

export function convertDebugProtocolVariableToIJupyterVariable(variable: DebugProtocol.Variable) {
    return {
        // If `evaluateName` is available use that. That is the name that we can eval in the debugger
        // but it's an optional property so fallback to `variable.name`
        name: variable.evaluateName ?? variable.name,
        type: variable.type!,
        count: 0,
        shape: '',
        size: 0,
        supportsDataExplorer: DataViewableTypes.has(variable.type || ''),
        value: variable.value,
        truncated: true,
        frameId: variable.variablesReference
    };
}
