// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import { ConfigurationTarget, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import { noop } from '../../platform/common/utils/misc';
import { IJupyterConnection } from '../types';
import { IJupyterServerUri, JupyterServerUriHandle } from './types';
import { getJupyterConnectionDisplayName } from './helpers';
import { IConfigurationService, IWatchableJupyterSettings, Resource } from '../../platform/common/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { DataScience } from '../../platform/common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Identifiers, Telemetry } from '../../platform/common/constants';
import { computeHash } from '../../platform/common/crypto';
import { traceError } from '../../platform/logging';

export function expandWorkingDir(
    workingDir: string | undefined,
    launchingFile: Resource,
    workspace: IWorkspaceService,
    settings: IWatchableJupyterSettings
): string {
    if (workingDir) {
        const variables = settings.createSystemVariables(launchingFile);
        return variables.resolve(workingDir);
    }

    // No working dir, just use the path of the launching file.
    if (launchingFile) {
        return path.dirname(getFilePath(launchingFile));
    }

    // No launching file or working dir. Just use the default workspace folder
    const workspaceFolder = workspace.getWorkspaceFolder(undefined);
    if (workspaceFolder) {
        return getFilePath(workspaceFolder.uri);
    }

    return process.cwd();
}

export async function handleSelfCertsError(
    appShell: IApplicationShell,
    config: IConfigurationService,
    message: string
): Promise<boolean> {
    // On a self cert error, warn the user and ask if they want to change the setting
    const enableOption: string = DataScience.jupyterSelfCertEnable;
    const closeOption: string = DataScience.jupyterSelfCertClose;
    const value = await appShell.showErrorMessage(
        DataScience.jupyterSelfCertFail(message),
        { modal: true },
        enableOption,
        closeOption
    );
    if (value === enableOption) {
        sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
        await config.updateSetting('allowUnauthorizedRemoteConnection', true, undefined, ConfigurationTarget.Workspace);
        return true;
    } else if (value === closeOption) {
        sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
    }
    return false;
}

export async function handleExpiredCertsError(
    appShell: IApplicationShell,
    config: IConfigurationService,
    message: string
): Promise<boolean> {
    // On a self cert error, warn the user and ask if they want to change the setting
    const enableOption: string = DataScience.jupyterSelfCertEnable;
    const closeOption: string = DataScience.jupyterSelfCertClose;
    const value = await appShell.showErrorMessage(
        DataScience.jupyterExpiredCertFail(message),
        { modal: true },
        enableOption,
        closeOption
    );
    if (value === enableOption) {
        sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
        await config.updateSetting('allowUnauthorizedRemoteConnection', true, undefined, ConfigurationTarget.Workspace);
        return true;
    } else if (value === closeOption) {
        sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
    }
    return false;
}

export async function createRemoteConnectionInfo(
    jupyterHandle: { id: string; handle: JupyterServerUriHandle },
    serverUri: IJupyterServerUri
): Promise<IJupyterConnection> {
    const serverId = await computeServerId(generateUriFromRemoteProvider(jupyterHandle.id, jupyterHandle.handle));
    const baseUrl = serverUri.baseUrl;
    const token = serverUri.token;
    const hostName = new URL(serverUri.baseUrl).hostname;
    const webSocketProtocols = (serverUri?.webSocketProtocols || []).length ? serverUri?.webSocketProtocols || [] : [];
    const authHeader =
        serverUri.authorizationHeader && Object.keys(serverUri?.authorizationHeader ?? {}).length > 0
            ? serverUri.authorizationHeader
            : undefined;
    return {
        serverId,
        baseUrl,
        providerId: jupyterHandle.id,
        token,
        hostName,
        localLaunch: false,
        displayName:
            serverUri && serverUri.displayName
                ? serverUri.displayName
                : getJupyterConnectionDisplayName(token, baseUrl),
        dispose: noop,
        rootDirectory: Uri.file(''),
        // Temporarily support workingDirectory as a fallback for old extensions using that (to be removed in the next release).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mappedRemoteNotebookDir: serverUri?.mappedRemoteNotebookDir || (serverUri as any)?.workingDirectory,
        // For remote jupyter servers that are managed by us, we can provide the auth header.
        // Its crucial this is set to undefined, else password retrieval will not be attempted.
        getAuthHeader: authHeader ? () => authHeader : undefined,
        getWebsocketProtocols: webSocketProtocols ? () => webSocketProtocols : () => []
    };
}

export async function computeServerId(uri: string) {
    return computeHash(uri, 'SHA-256');
}

export function generateUriFromRemoteProvider(id: string, result: JupyterServerUriHandle) {
    // eslint-disable-next-line
    return `${Identifiers.REMOTE_URI}?${Identifiers.REMOTE_URI_ID_PARAM}=${id}&${
        Identifiers.REMOTE_URI_HANDLE_PARAM
    }=${encodeURI(result)}`;
}

export function extractJupyterServerHandleAndId(uri: string): { handle: JupyterServerUriHandle; id: string } {
    try {
        const url: URL = new URL(uri);

        // Id has to be there too.
        const id = url.searchParams.get(Identifiers.REMOTE_URI_ID_PARAM);
        const uriHandle = url.searchParams.get(Identifiers.REMOTE_URI_HANDLE_PARAM);
        if (id && uriHandle) {
            return { handle: uriHandle, id };
        }
        throw new Error('Invalid remote URI');
    } catch (ex) {
        traceError('Failed to parse remote URI', uri, ex);
        throw new Error(`'Failed to parse remote URI ${uri}`);
    }
}
