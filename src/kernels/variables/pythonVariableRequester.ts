// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { traceError } from '../../platform/logging';
import { DataScience } from '../../platform/common/utils/localize';
import { stripAnsi } from '../../platform/common/utils/regexp';
import { JupyterDataRateLimitError } from '../../platform/errors/jupyterDataRateLimitError';
import { Telemetry } from '../../telemetry';
import { executeSilently, SilentExecutionErrorOptions } from '../helpers';
import { IKernel } from '../types';
import { IKernelVariableRequester, IJupyterVariable, IVariableDescription } from './types';
import { IDataFrameScriptGenerator, IVariableScriptGenerator } from '../../platform/common/types';
import { SessionDisposedError } from '../../platform/errors/sessionDisposedError';

type DataFrameSplitFormat = {
    index: (number | string)[];
    columns: string[];
    data: Record<string, unknown>[];
};

export function parseDataFrame(df: DataFrameSplitFormat) {
    const rowIndexValues = df.index;
    const columns = df.columns;
    const rowData = df.data;
    const data = rowData.map((row, index) => {
        const rowData: Record<string, unknown> = {
            index: rowIndexValues[index]
        };
        columns.forEach((column, columnIndex) => {
            rowData[column] = row[columnIndex];
        });
        return rowData;
    });
    return { data };
}

async function safeExecuteSilently(
    kernel: IKernel,
    { code, initializeCode, cleanupCode }: { code: string; initializeCode?: string; cleanupCode?: string },
    errorOptions?: SilentExecutionErrorOptions
): Promise<nbformat.IOutput[]> {
    if (
        kernel.disposed ||
        kernel.disposing ||
        !kernel.session?.kernel ||
        !kernel.session.kernel ||
        kernel.session.isDisposed
    ) {
        return [];
    }
    try {
        if (initializeCode) {
            await executeSilently(kernel.session.kernel, initializeCode, errorOptions);
        }
        return await executeSilently(kernel.session.kernel, code, errorOptions);
    } catch (ex) {
        if (ex instanceof SessionDisposedError) {
            return [];
        }
        throw ex;
    } finally {
        if (cleanupCode) {
            await executeSilently(kernel.session.kernel, cleanupCode, errorOptions);
        }
    }
}

/**
 * When a kernel is a python kernel, the KernelVariables class will use this object to request variables.
 */
@injectable()
export class PythonVariablesRequester implements IKernelVariableRequester {
    constructor(
        @inject(IVariableScriptGenerator) private readonly varScriptGenerator: IVariableScriptGenerator,
        @inject(IDataFrameScriptGenerator) private readonly dfScriptGenerator: IDataFrameScriptGenerator
    ) {}

    public async getDataFrameInfo(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        expression: string
    ): Promise<IJupyterVariable> {
        // Then execute a call to get the info and turn it into JSON
        const { code, cleanupCode, initializeCode } = await this.dfScriptGenerator.generateCodeToGetDataFrameInfo({
            isDebugging: false,
            variableName: expression
        });
        const results = await safeExecuteSilently(
            kernel,
            { code, cleanupCode, initializeCode },
            {
                traceErrors: true,
                traceErrorsMessage: 'Failure in execute_request for getDataFrameInfo',
                telemetryName: Telemetry.PythonVariableFetchingCodeFailure
            }
        );

        const fileName = kernel.notebook?.uri || kernel.resourceUri || kernel.uri;

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results),
            fileName
        };
    }

    public async getDataFrameRows(
        start: number,
        end: number,
        kernel: IKernel,
        expression: string
    ): Promise<{ data: Record<string, unknown>[] }> {
        // Then execute a call to get the rows and turn it into JSON
        const { code, cleanupCode, initializeCode } = await this.dfScriptGenerator.generateCodeToGetDataFrameRows({
            isDebugging: false,
            variableName: expression,
            startIndex: start,
            endIndex: end
        });
        const results = await safeExecuteSilently(
            kernel,
            { code, cleanupCode, initializeCode },
            {
                traceErrors: true,
                traceErrorsMessage: 'Failure in execute_request for getDataFrameRows',
                telemetryName: Telemetry.PythonVariableFetchingCodeFailure
            }
        );
        if (results.length === 0) {
            return { data: [] };
        }
        return parseDataFrame(this.deserializeJupyterResult<DataFrameSplitFormat>(results));
    }

    public async getVariableProperties(
        word: string,
        _cancelToken: CancellationToken | undefined,
        matchingVariable: IJupyterVariable | undefined
    ): Promise<{ [attributeName: string]: string }> {
        let result: { [attributeName: string]: string } = {};
        if (matchingVariable && matchingVariable.value) {
            result[`${word}`] = matchingVariable.value;
        }
        return result;
    }

    public async getAllVariableDiscriptions(
        kernel: IKernel,
        parent: IVariableDescription | undefined,
        token?: CancellationToken
    ): Promise<IVariableDescription[]> {
        if (!kernel.session) {
            return [];
        }

        const { code, cleanupCode, initializeCode } =
            await this.varScriptGenerator.generateCodeToGetAllVariableDescriptions({
                isDebugging: false,
                parent
            });

        const results = await safeExecuteSilently(
            kernel,
            { code, cleanupCode, initializeCode },
            {
                traceErrors: true,
                traceErrorsMessage: 'Failure in execute_request when retrieving variables',
                telemetryName: Telemetry.PythonVariableFetchingCodeFailure
            }
        );

        if (kernel.disposed || kernel.disposing || token?.isCancellationRequested) {
            return [];
        }

        return this.deserializeJupyterResult(results) as Promise<IVariableDescription[]>;
    }

    public async getVariableNamesAndTypesFromKernel(
        kernel: IKernel,
        _token?: CancellationToken
    ): Promise<IJupyterVariable[]> {
        if (kernel.session) {
            // VariableTypesFunc takes in list of vars and the corresponding var names
            const { code, cleanupCode, initializeCode } = await this.varScriptGenerator.generateCodeToGetVariableTypes({
                isDebugging: false
            });
            const results = await safeExecuteSilently(
                kernel,
                { code, cleanupCode, initializeCode },
                {
                    traceErrors: true,
                    traceErrorsMessage: 'Failure in execute_request for getVariableNamesAndTypesFromKernel',
                    telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                }
            );

            if (kernel.disposed || kernel.disposing) {
                return [];
            }
            const varNameTypeMap = this.deserializeJupyterResult(results) as Map<String, String>;

            const vars = [];
            for (const [name, type] of Object.entries(varNameTypeMap)) {
                const v: IJupyterVariable = {
                    name: name,
                    value: undefined,
                    supportsDataExplorer: false,
                    type: type || '',
                    size: 0,
                    shape: '',
                    count: 0,
                    truncated: true
                };
                vars.push(v);
            }
            return vars;
        }

        return [];
    }

    public async getFullVariable(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        _token?: CancellationToken
    ): Promise<IJupyterVariable> {
        // Then execute a call to get the info and turn it into JSON
        const { code, cleanupCode, initializeCode } = await this.varScriptGenerator.generateCodeToGetVariableInfo({
            isDebugging: false,
            variableName: targetVariable.name
        });
        const results = await safeExecuteSilently(
            kernel,
            { code, cleanupCode, initializeCode },
            {
                traceErrors: true,
                traceErrorsMessage: 'Failure in execute_request for getFullVariable',
                telemetryName: Telemetry.PythonVariableFetchingCodeFailure
            }
        );

        // Combine with the original result (the call only returns the new fields)
        return {
            ...targetVariable,
            ...this.deserializeJupyterResult(results)
        };
    }
    private extractJupyterResultText(outputs: nbformat.IOutput[]): string {
        // Verify that we have the correct cell type and outputs
        if (outputs.length > 0) {
            const codeCellOutput = outputs[0] as nbformat.IOutput;
            if (
                codeCellOutput &&
                codeCellOutput.output_type === 'stream' &&
                codeCellOutput.name === 'stderr' &&
                codeCellOutput.hasOwnProperty('text')
            ) {
                const resultString = codeCellOutput.text as string;
                // See if this the IOPUB data rate limit problem
                if (resultString.includes('iopub_data_rate_limit')) {
                    throw new JupyterDataRateLimitError();
                } else {
                    const error = DataScience.jupyterGetVariablesExecutionError(resultString);
                    traceError(error);
                    throw new Error(error);
                }
            }
            if (codeCellOutput && codeCellOutput.output_type === 'execute_result') {
                const data = codeCellOutput.data;
                if (data && data.hasOwnProperty('text/plain')) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (data as any)['text/plain'];
                }
            }
            if (codeCellOutput && codeCellOutput.output_type === 'stream' && codeCellOutput.hasOwnProperty('text')) {
                return codeCellOutput.text as string;
            }
            if (
                codeCellOutput &&
                codeCellOutput.output_type === 'error' &&
                codeCellOutput.hasOwnProperty('traceback')
            ) {
                const traceback: string[] = codeCellOutput.traceback as string[];
                const stripped = traceback.map(stripAnsi).join('\r\n');
                const error = DataScience.jupyterGetVariablesExecutionError(stripped);
                traceError(error);
                throw new Error(error);
            }
        }

        throw new Error(DataScience.jupyterGetVariablesBadResults);
    }

    // Pull our text result out of the Jupyter cell
    private deserializeJupyterResult<T>(outputs: nbformat.IOutput[]): T {
        const text = this.extractJupyterResultText(outputs);
        return JSON.parse(text) as T;
    }
}
