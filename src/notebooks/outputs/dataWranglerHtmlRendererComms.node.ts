import * as vscode from 'vscode';
import { injectable, inject, named } from 'inversify';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { IExportedKernelServiceFactory } from '../../platform/api/types';
import { IJupyterVariables } from '../../kernels/variables/types';
import { IExportedKernelService } from '../../platform/api/extension';
import type { IDataWranglerExtensionAPI } from '../../../typings/dataWrangler';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { traceError } from '../../platform/logging';
import { IDataScienceErrorHandler } from '../../platform/errors/types';
import { Identifiers } from '../../platform/common/constants';
import { IKernelProvider } from '../../kernels/types';

const pythonVariablePattern = '[a-zA-Z_][a-zA-Z0-9_]*';
const pythonNumberPattern = '[0-9]+';
const dfHeadPattern = `(${pythonVariablePattern})\\.head\\(\\s*(${pythonVariablePattern}|${pythonNumberPattern}|)\\s*\\)\\s*`;

/**
 * Helper to determine whether the output is a Pandas output.
 * Specifically, we will only support the following syntaxes:
 * 1. <df_variable_name>
 * 2. <df_variable_name>.head(<number or variable_name>)
 * 3. <anything>; <df_variable_name>
 * 4. <anything>; <df_variable_name>.head(<number or variable_name>)
 *
 * TODO@DW: consider adding support for print(<df_variable_name>)
 * the above uses a non-HTML format, so we would probably want to add
 * special detection for that as well.
 */
export function extractVariableNameFromLine(code: string) {
    // case 1: <df_variable_name>
    const varMatches = code.match(new RegExp(`^(${pythonVariablePattern})\\s*$`));
    if (varMatches?.length && varMatches.length > 1) {
        return varMatches[1];
    }
    // case 2: <df_variable_name>.head(<number or variable_name>)
    const headMatches = code.match(new RegExp(`^${dfHeadPattern}$`));
    if (headMatches?.length && headMatches.length > 1) {
        return headMatches[1];
    }
    // case 3: <anything>; <df_variable_name>
    const multiLineVarMatches = code.match(new RegExp(`^.*;\\s*(${pythonVariablePattern})\\s*$`));
    if (multiLineVarMatches?.length && multiLineVarMatches.length > 1) {
        return multiLineVarMatches[1];
    }
    // case 4: <anything>; <df_variable_name>
    const multiLineHeadMatches = code.match(new RegExp(`^.*;\\s*${dfHeadPattern}$`));
    if (multiLineHeadMatches?.length && multiLineHeadMatches.length > 1) {
        return multiLineHeadMatches[1];
    }
    return undefined;
}

export function getDataFrameVariableNameFromSource(source: string): string | undefined {
    const lines = source.trim().split('\n');
    if (lines.length === 0) {
        return undefined;
    }

    // only look at the last line (after trimming whitespace)
    const lastLine = lines[lines.length - 1];
    return extractVariableNameFromLine(lastLine);
}

/**
 * Host for the Data Wrangler entrypoint renderer.
 */
@injectable()
export class DataWranglerHtmlRendererCommunicationHandler implements IExtensionSingleActivationService {
    private readonly outputIdToVariableName: { [outputId: string]: string } = {};

    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IExportedKernelServiceFactory) private readonly kernelServiceFactory: IExportedKernelServiceFactory,
        @inject(IJupyterVariables)
        @named(Identifiers.KERNEL_VARIABLES)
        private readonly jupyterVariables: IJupyterVariables,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider
    ) {}

    public async activate(): Promise<void> {
        const dataWranglerExtension =
            vscode.extensions.getExtension<IDataWranglerExtensionAPI>('ms-toolsai.data-wrangler');

        // do nothing if there is no data wrangler extension
        if (!dataWranglerExtension) {
            return;
        }

        const kernelService = await this.kernelServiceFactory.getServiceInternal();

        // do nothing if we couldn't get the kernel service
        if (!kernelService) {
            return;
        }

        // establish messaging channel with the custom renderer
        const messaging = vscode.notebooks.createRendererMessaging('jupyter-data-wrangler-html-renderer');
        this.disposables.push(
            messaging.onDidReceiveMessage(this.messageHandler(messaging, kernelService, dataWranglerExtension))
        );

        // signal that Data Wrangler is ready
        void messaging.postMessage({ type: 'dataWranglerIsAvailable', payload: true });
    }

    /**
     * Handles whether or not to show the "Launch Data Wrangler" button in outputs.
     */
    private async handleShowLaunchButton(
        editor: vscode.NotebookEditor,
        cell: vscode.NotebookCell,
        outputId: string,
        messagingChannel: vscode.NotebookRendererMessaging
    ) {
        try {
            // parse the cell source to see if it matches an expected pattern
            const source = cell.document.getText();
            const variableName = getDataFrameVariableNameFromSource(source);
            if (!variableName) {
                return await messagingChannel.postMessage(
                    {
                        type: 'shouldShowLaunchButtonResponse',
                        payload: false
                    },
                    editor
                );
            }

            // sanity check: make sure that the variable actually exists
            const kernel = this.kernelProvider.get(editor.document.uri);
            const variable = await this.jupyterVariables.getMatchingVariable(variableName, kernel);
            const result = !!variable;
            if (result) {
                this.outputIdToVariableName[outputId] = variableName;
            }
            return await messagingChannel.postMessage(
                {
                    type: 'shouldShowLaunchButtonResponse',
                    payload: result
                },
                editor
            );
        } catch (e) {
            // if we received any unexpected errors, also don't show the button
            return await messagingChannel.postMessage(
                {
                    type: 'shouldShowLaunchButtonResponse',
                    payload: false
                },
                editor
            );
        }
    }

    /**
     * Handles the intent to launch Data Wrangler
     */
    private async handleLaunchDataWrangler(
        editor: vscode.NotebookEditor,
        outputId: string,
        messagingChannel: vscode.NotebookRendererMessaging,
        dataWranglerExtension: vscode.Extension<IDataWranglerExtensionAPI>,
        kernelService: IExportedKernelService
    ) {
        sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST);
        // retrieve the variable name
        const variableName = this.outputIdToVariableName[outputId];
        if (!variableName) {
            return await messagingChannel.postMessage(
                {
                    type: 'variableWasLost',
                    payload: variableName
                },
                editor
            );
        }

        try {
            // sanity check: make sure that the variable actually exists
            const kernel = this.kernelProvider.get(editor.document.uri);
            const variable = await this.jupyterVariables.getMatchingVariable(variableName, kernel);
            if (!variable) {
                return await messagingChannel.postMessage(
                    {
                        type: 'variableWasLost',
                        payload: variableName
                    },
                    editor
                );
            }

            // check if we should activate the extension
            if (!dataWranglerExtension.isActive) {
                await dataWranglerExtension.activate();
                await dataWranglerExtension.exports.ready;
            }

            const kernelInfo = kernelService.getKernel(editor.document.uri);
            if (!kernelInfo) {
                return await messagingChannel.postMessage(
                    {
                        type: 'variableWasLost',
                        payload: variableName
                    },
                    editor
                );
            }

            await dataWranglerExtension.exports.launchDataWranglerUsingVariable(
                editor.document.uri,
                variableName,
                kernelInfo,
                {
                    outputId
                }
            );
            sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS);
        } catch (e) {
            // if anything went wrong, also disable the button and show an error message
            sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR, undefined, undefined, e);
            traceError(e);
            void this.errorHandler.handleError(e);
            return await messagingChannel.postMessage(
                {
                    type: 'variableWasLost',
                    payload: variableName
                },
                editor
            );
        }
    }

    private handleDispose(outputId: string) {
        delete this.outputIdToVariableName[outputId];
    }

    private messageHandler =
        (
            messagingChannel: vscode.NotebookRendererMessaging,
            kernelService: IExportedKernelService,
            dataWranglerExtension: vscode.Extension<IDataWranglerExtensionAPI>
        ) =>
        async (event: {
            readonly editor: vscode.NotebookEditor;
            readonly message: {
                type: string;
                outputId: string;
            };
        }) => {
            const cell = event.editor.document
                .getCells()
                .find((cell) => cell.outputs.some((output) => output.id === event.message.outputId));

            // if the corresponding cell for the output rendering no longer exists, we can ignore it
            if (!cell) {
                return;
            }

            switch (event.message.type) {
                case 'shouldShowLaunchButton':
                    return await this.handleShowLaunchButton(
                        event.editor,
                        cell,
                        event.message.outputId,
                        messagingChannel
                    );
                case 'launchDataWrangler':
                    return await this.handleLaunchDataWrangler(
                        event.editor,
                        event.message.outputId,
                        messagingChannel,
                        dataWranglerExtension,
                        kernelService
                    );
                case 'dispose':
                    return this.handleDispose(event.message.outputId);
            }
        };
}
