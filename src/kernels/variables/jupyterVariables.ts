// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';

import { CancellationToken, Event, EventEmitter } from 'vscode';
import { IDisposableRegistry } from '../../platform/common/types';
import { Identifiers } from '../../platform/common/constants';
import { capturePerfTelemetry, Telemetry } from '../../telemetry';
import { IKernel } from '../types';
import {
    IJupyterVariables,
    IConditionalJupyterVariables,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse,
    IJupyterVariable
} from './types';

/**
 * This class provides variable data for showing in the interactive window or a notebook.
 * It multiplexes to either one that will use the jupyter kernel or one that uses the debugger.
 */
@injectable()
export class JupyterVariables implements IJupyterVariables {
    private refreshEventEmitter = new EventEmitter<void>();
    constructor(
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IJupyterVariables) @named(Identifiers.KERNEL_VARIABLES) private kernelVariables: IJupyterVariables,
        @inject(IJupyterVariables)
        @named(Identifiers.DEBUGGER_VARIABLES)
        private debuggerVariables: IConditionalJupyterVariables
    ) {
        disposableRegistry.push(debuggerVariables.refreshRequired(this.fireRefresh.bind(this)));
        disposableRegistry.push(kernelVariables.refreshRequired(this.fireRefresh.bind(this)));
    }

    public get refreshRequired(): Event<void> {
        return this.refreshEventEmitter.event;
    }

    // IJupyterVariables implementation
    @capturePerfTelemetry(Telemetry.VariableExplorerFetchTime)
    public async getVariables(request: IJupyterVariablesRequest, kernel?: IKernel): Promise<IJupyterVariablesResponse> {
        return this.variableHandler.getVariables(request, kernel);
    }

    public async getFullVariable(variable: IJupyterVariable, kernel?: IKernel): Promise<IJupyterVariable> {
        return this.variableHandler.getFullVariable(variable, kernel);
    }

    public async getMatchingVariable(
        name: string,
        kernel?: IKernel,
        cancelToken?: CancellationToken
    ): Promise<IJupyterVariable | undefined> {
        return this.variableHandler.getMatchingVariable(name, kernel, cancelToken);
    }

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        kernel?: IKernel,
        sliceExpression?: string,
        isRefresh?: boolean
    ): Promise<IJupyterVariable> {
        return this.variableHandler.getDataFrameInfo(targetVariable, kernel, sliceExpression, isRefresh);
    }

    public async getDataFrameRows(
        targetVariable: IJupyterVariable,
        start: number,
        end: number,
        kernel?: IKernel,
        sliceExpression?: string
    ): Promise<{ data: Record<string, unknown>[] }> {
        return this.variableHandler.getDataFrameRows(targetVariable, start, end, kernel, sliceExpression);
    }

    private get variableHandler(): IJupyterVariables {
        if (this.debuggerVariables.active) {
            return this.debuggerVariables;
        }

        return this.kernelVariables;
    }

    private fireRefresh() {
        this.refreshEventEmitter.fire();
    }
}
