// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { JSONObject } from '@lumino/coreutils';
import { inject, injectable, named } from 'inversify';

import { CancellationToken, Event, EventEmitter } from 'vscode';
import { IDisposableRegistry } from '../../common/types';
import { captureTelemetry } from '../../telemetry';
import { Identifiers, Telemetry } from '../constants';
import {
    IConditionalJupyterVariables,
    IJupyterVariable,
    IJupyterVariables,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse
} from '../types';
import { IKernel } from './kernels/types';

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
    @captureTelemetry(Telemetry.VariableExplorerFetchTime, undefined, true)
    public async getVariables(request: IJupyterVariablesRequest, kernel?: IKernel): Promise<IJupyterVariablesResponse> {
        return (await this.getVariableHandler()).getVariables(request, kernel);
    }

    public async getFullVariable(variable: IJupyterVariable, kernel?: IKernel): Promise<IJupyterVariable> {
        return (await this.getVariableHandler()).getFullVariable(variable, kernel);
    }

    public async getMatchingVariable(
        name: string,
        kernel?: IKernel,
        cancelToken?: CancellationToken
    ): Promise<IJupyterVariable | undefined> {
        return (await this.getVariableHandler()).getMatchingVariable(name, kernel, cancelToken);
    }

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        kernel?: IKernel,
        sliceExpression?: string,
        isRefresh?: boolean
    ): Promise<IJupyterVariable> {
        return (await this.getVariableHandler()).getDataFrameInfo(targetVariable, kernel, sliceExpression, isRefresh);
    }

    public async getDataFrameRows(
        targetVariable: IJupyterVariable,
        start: number,
        end: number,
        kernel?: IKernel,
        sliceExpression?: string
    ): Promise<JSONObject> {
        return (await this.getVariableHandler()).getDataFrameRows(targetVariable, start, end, kernel, sliceExpression);
    }

    private async getVariableHandler(): Promise<IJupyterVariables> {
        if (this.debuggerVariables.active) {
            return this.debuggerVariables;
        }

        return this.kernelVariables;
    }

    private fireRefresh() {
        this.refreshEventEmitter.fire();
    }
}
