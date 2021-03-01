// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { JSONObject } from '@phosphor/coreutils';
import { inject, injectable, named } from 'inversify';

import { CancellationToken, Event, EventEmitter } from 'vscode';
import { ServerStatus } from '../../../datascience-ui/interactive-common/mainState';
import { IDisposableRegistry } from '../../common/types';
import { captureTelemetry } from '../../telemetry';
import { Identifiers, Telemetry } from '../constants';
import {
    IConditionalJupyterVariables,
    IJupyterVariable,
    IJupyterVariables,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse,
    INotebook
} from '../types';

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
    public async getVariables(
        request: IJupyterVariablesRequest,
        notebook?: INotebook
    ): Promise<IJupyterVariablesResponse> {
        return (await this.getVariableHandler(notebook)).getVariables(request, notebook);
    }

    public async getFullVariable(variable: IJupyterVariable, notebook?: INotebook): Promise<IJupyterVariable> {
        return (await this.getVariableHandler(notebook)).getFullVariable(variable, notebook);
    }

    public async getMatchingVariable(
        name: string,
        notebook?: INotebook,
        cancelToken?: CancellationToken
    ): Promise<IJupyterVariable | undefined> {
        return (await this.getVariableHandler(notebook)).getMatchingVariable(name, notebook, cancelToken);
    }

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        notebook?: INotebook,
        sliceExpression?: string,
        isRefresh?: boolean
    ): Promise<IJupyterVariable> {
        return (await this.getVariableHandler(notebook)).getDataFrameInfo(
            targetVariable,
            notebook,
            sliceExpression,
            isRefresh
        );
    }

    public async getDataFrameRows(
        targetVariable: IJupyterVariable,
        start: number,
        end: number,
        notebook?: INotebook,
        sliceExpression?: string
    ): Promise<JSONObject> {
        return (await this.getVariableHandler(notebook)).getDataFrameRows(
            targetVariable,
            start,
            end,
            notebook,
            sliceExpression
        );
    }

    private async getVariableHandler(notebook?: INotebook): Promise<IJupyterVariables> {
        if (this.debuggerVariables.active && (!notebook || notebook.status === ServerStatus.Busy)) {
            return this.debuggerVariables;
        }

        return this.kernelVariables;
    }

    private fireRefresh() {
        this.refreshEventEmitter.fire();
    }
}
