// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationToken,
    LanguageModelTextPart,
    LanguageModelTool,
    LanguageModelToolInvocationOptions,
    LanguageModelToolInvocationPrepareOptions,
    LanguageModelToolResult,
    NotebookDocument,
    PreparedToolInvocation,
    ProviderResult,
    Uri,
    window,
    workspace
} from 'vscode';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { isEqual } from '../../platform/vscode-path/resources';
import { isJupyterNotebook } from '../../platform/common/utils';
import { BaseError, WrappedError } from '../../platform/errors/types';
import { isCancellationError } from '../../platform/common/cancellation';

export interface IBaseToolParams {
    filePath: string;
}

export function sendConfigureNotebookToolCallTelemetry(
    resource: Uri,
    telemetry: {
        createdEnv?: boolean;
        installedPythonExtension?: boolean;
        isPython?: boolean;
    }
) {
    void getTelemetrySafeHashedString(resource.fsPath).then((resourceHash) => {
        sendTelemetryEvent(Telemetry.ConfigureNotebookToolCall, undefined, {
            resourceHash,
            createdEnv: telemetry.createdEnv === true,
            installedPythonExtension: telemetry.installedPythonExtension === true,
            isPython: telemetry.isPython === true
        });
    });
}

export abstract class BaseTool<T extends IBaseToolParams> implements LanguageModelTool<T> {
    constructor(private readonly toolName: string) {}

    public async invoke(options: LanguageModelToolInvocationOptions<T>, token: CancellationToken) {
        if (!workspace.isTrusted) {
            return new LanguageModelToolResult([
                new LanguageModelTextPart('Cannot use this tool in an untrusted workspace.')
            ]);
        }

        let error: Error | undefined;
        let notebookUri: Uri | undefined;
        try {
            const notebook = await resolveNotebookFromFilePath(options.input.filePath);
            return await this.invokeImpl(options, notebook, token);
        } catch (ex) {
            error = ex;
            throw ex;
        } finally {
            const isCancelled = token.isCancellationRequested || (error ? isCancellationError(error, true) : false);
            const failed = !!error || isCancelled ? 'true' : 'false';
            const failureCategory = isCancelled
                ? 'cancelled'
                : error
                ? error instanceof BaseError
                    ? error.category
                    : 'error'
                : undefined;
            const resourceHash = notebookUri
                ? getTelemetrySafeHashedString(notebookUri.fsPath)
                : Promise.resolve(undefined);
            void resourceHash.then((resourceHash) => {
                sendTelemetryEvent(Telemetry.InvokeTool, undefined, {
                    toolName: this.toolName,
                    resourceHash,
                    failed,
                    failureCategory
                });
            });
        }
    }

    async prepareInvocation(
        options: LanguageModelToolInvocationPrepareOptions<T>,
        token: CancellationToken
    ): Promise<PreparedToolInvocation> {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);
        return this.prepareInvocationImpl(options, notebook, token);
    }
    protected abstract invokeImpl(
        options: LanguageModelToolInvocationOptions<T>,
        notebook: NotebookDocument,
        token: CancellationToken
    ): ProviderResult<LanguageModelToolResult>;
    protected abstract prepareInvocationImpl(
        options: LanguageModelToolInvocationPrepareOptions<T>,
        notebook: NotebookDocument,
        token: CancellationToken
    ): Promise<PreparedToolInvocation>;
}

async function resolveNotebookFromFilePath(filePath: string) {
    const uri = Uri.file(filePath);
    let parsedUri = uri;
    try {
        parsedUri = Uri.parse(filePath);
    } catch {
        //
    }
    let notebook =
        workspace.notebookDocuments.find((doc) => doc.uri.path === filePath || doc.uri.fsPath === filePath) ||
        workspace.notebookDocuments.find((doc) => isEqual(doc.uri, uri)) ||
        workspace.notebookDocuments.find((doc) => doc.uri.path === filePath || doc.uri.fsPath === parsedUri.fsPath) ||
        workspace.notebookDocuments.find((doc) => isEqual(doc.uri, parsedUri));
    notebook = notebook || (await workspace.openNotebookDocument(uri));
    if (!notebook) {
        throw new WrappedError(`Unable to find notebook at ${filePath}.`, undefined, 'notebookNotFound');
    }
    if (!isJupyterNotebook(notebook)) {
        throw new WrappedError(
            `The notebook at ${filePath} is not a Jupyter notebook This tool can only be used with Jupyter Notebooks.`,
            undefined,
            'nonJupyterNotebook'
        );
    }
    if (!window.visibleNotebookEditors.find((e) => e.notebook === notebook)) {
        await window.showNotebookDocument(notebook);
    }
    return notebook;
}
