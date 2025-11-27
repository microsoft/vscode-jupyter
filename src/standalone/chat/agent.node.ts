// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { logger } from '../../platform/logging';

const JUPYTER_AGENT_ID = 'jupyter.jupyterAgent';

/**
 * Creates and registers a Jupyter chat participant (agent) that can handle
 * user requests for Jupyter notebook assistance.
 */
export function registerJupyterChatAgent(context: vscode.ExtensionContext): void {
    const agent = vscode.chat.createChatParticipant(JUPYTER_AGENT_ID, handleChatRequest);
    agent.iconPath = new vscode.ThemeIcon('notebook');

    context.subscriptions.push(agent);
    logger.info('Jupyter Chat Agent registered');
}

/**
 * Handles incoming chat requests to the Jupyter agent.
 */
async function handleChatRequest(
    _request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult | undefined> {
    if (token.isCancellationRequested) {
        return undefined;
    }

    try {
        // Stream a response to the user
        stream.markdown(`I'm the Jupyter assistant. I can help you work with Jupyter notebooks.\n\n`);
        stream.markdown(
            `I can assist with:\n` +
                `- Configuring notebooks and kernels\n` +
                `- Installing packages in notebook kernels\n` +
                `- Listing installed packages\n` +
                `- Restarting kernels\n\n`
        );
        stream.markdown(`To get started, open a Jupyter notebook and I'll help you configure and work with it.`);

        return {};
    } catch (error) {
        logger.error('Error handling Jupyter chat request', error);
        stream.markdown(
            `An error occurred while processing your request. Please check your input and try again, or report an issue if the problem persists.`
        );
        return undefined;
    }
}
