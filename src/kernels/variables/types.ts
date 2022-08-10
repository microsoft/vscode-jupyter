// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { CancellationToken, Event, Uri } from 'vscode';
import { IKernel } from '../types';
import type { JSONObject } from '@lumino/coreutils';

// Get variables from the currently running active Jupyter server or debugger
// Note: This definition is used implicitly by getJupyterVariableValue.py file
// Changes here may need to be reflected there as well
export interface IJupyterVariable {
    name: string;
    value: string | undefined;
    executionCount?: number;
    supportsDataExplorer: boolean;
    type: string;
    size: number;
    shape: string;
    dataDimensionality?: number;
    count: number;
    truncated: boolean;
    columns?: { key: string; type: string }[];
    rowCount?: number;
    indexColumn?: string;
    maximumRowChunkSize?: number;
    fileName?: Uri;
}

export const IJupyterVariables = Symbol('IJupyterVariables');
export interface IJupyterVariables {
    readonly refreshRequired: Event<void>;
    getVariables(request: IJupyterVariablesRequest, kernel?: IKernel): Promise<IJupyterVariablesResponse>;
    getFullVariable(
        variable: IJupyterVariable,
        kernel?: IKernel,
        cancelToken?: CancellationToken
    ): Promise<IJupyterVariable>;
    getDataFrameInfo(
        targetVariable: IJupyterVariable,
        kernel?: IKernel,
        sliceExpression?: string,
        isRefresh?: boolean
    ): Promise<IJupyterVariable>;
    getDataFrameRows(
        targetVariable: IJupyterVariable,
        start: number,
        end: number,
        kernel?: IKernel,
        sliceExpression?: string
    ): Promise<{ data: Record<string, unknown>[] }>;
    getMatchingVariable(
        name: string,
        kernel?: IKernel,
        cancelToken?: CancellationToken
    ): Promise<IJupyterVariable | undefined>;
    // This is currently only defined in kernelVariables.ts
    getVariableProperties?(name: string, kernel?: IKernel, cancelToken?: CancellationToken): Promise<JSONObject>;
}

export interface IConditionalJupyterVariables extends IJupyterVariables {
    readonly active: boolean;
}

// Request for variables
export interface IJupyterVariablesRequest {
    executionCount: number;
    refreshCount: number;
    sortColumn: string;
    sortAscending: boolean;
    startIndex: number;
    pageSize: number;
}

// Response to a request
export interface IJupyterVariablesResponse {
    executionCount: number;
    totalCount: number;
    pageStartIndex: number;
    pageResponse: IJupyterVariable[];
    refreshCount: number;
}

export const IKernelVariableRequester = Symbol('IKernelVariableRequester');

export interface IKernelVariableRequester {
    getVariableNamesAndTypesFromKernel(kernel: IKernel, token?: CancellationToken): Promise<IJupyterVariable[]>;
    getFullVariable(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        token?: CancellationToken
    ): Promise<IJupyterVariable>;
    getDataFrameRows(
        start: number,
        end: number,
        kernel: IKernel,
        expression: string
    ): Promise<{ data: Record<string, unknown>[] }>;
    getVariableProperties(
        word: string,
        kernel: IKernel,
        cancelToken: CancellationToken | undefined,
        matchingVariable: IJupyterVariable | undefined,
        languageSettings: { [typeNameKey: string]: string[] },
        inEnhancedTooltipsExperiment: boolean
    ): Promise<{ [attributeName: string]: string }>;
    getDataFrameInfo(targetVariable: IJupyterVariable, kernel: IKernel, expression: string): Promise<IJupyterVariable>;
}
