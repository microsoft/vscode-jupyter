// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import { ConfigurationTarget, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import { noop } from '../../platform/common/utils/misc';
import { IJupyterConnection } from '../types';
import { getJupyterConnectionDisplayName } from './helpers';
import { IConfigurationService, IWatchableJupyterSettings, Resource } from '../../platform/common/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { DataScience } from '../../platform/common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Identifiers, JVSC_EXTENSION_ID, Telemetry, isBuiltInJupyterProvider } from '../../platform/common/constants';
import { computeHash } from '../../platform/common/crypto';
import { IJupyterServerUri } from '../../api';
import { traceWarning } from '../../platform/logging';
import { JupyterServerProviderHandle } from './types';

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
    jupyterHandle: JupyterServerProviderHandle,
    serverUri: IJupyterServerUri
): Promise<IJupyterConnection> {
    const baseUrl = serverUri.baseUrl;
    const token = serverUri.token;
    const hostName = new URL(serverUri.baseUrl).hostname;
    const webSocketProtocols = (serverUri?.webSocketProtocols || []).length ? serverUri?.webSocketProtocols || [] : [];
    const authHeader =
        serverUri.authorizationHeader && Object.keys(serverUri?.authorizationHeader ?? {}).length > 0
            ? serverUri.authorizationHeader
            : undefined;
    return {
        baseUrl,
        providerId: jupyterHandle.id,
        serverProviderHandle: jupyterHandle,
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

const ExtensionsWithKnownProviderIds = new Set(
    [JVSC_EXTENSION_ID, 'ms-toolsai.vscode-ai', 'GitHub.codespaces'].map((e) => e.toLowerCase())
);

export function generateIdFromRemoteProvider(provider: JupyterServerProviderHandle) {
    if (ExtensionsWithKnownProviderIds.has(provider.extensionId.toLowerCase())) {
        // For extensions that we support migration, like AzML and Jupyter extension and the like,
        // we can ignore storing the extension id in the url.
        // eslint-disable-next-line
        return `${Identifiers.REMOTE_URI}?${Identifiers.REMOTE_URI_ID_PARAM}=${provider.id}&${
            Identifiers.REMOTE_URI_HANDLE_PARAM
        }=${encodeURI(provider.handle)}`;
    } else {
        return `${Identifiers.REMOTE_URI}?${Identifiers.REMOTE_URI_ID_PARAM}=${provider.id}&${
            Identifiers.REMOTE_URI_HANDLE_PARAM
        }=${encodeURI(provider.handle)}&${Identifiers.REMOTE_URI_EXTENSION_ID_PARAM}=${encodeURI(
            provider.extensionId
        )}`;
    }
}

class FailedToDetermineExtensionId extends Error {}
export function extractJupyterServerHandleAndId(uri: string): JupyterServerProviderHandle {
    try {
        const url: URL = new URL(uri);

        // Id has to be there too.
        const id = url.searchParams.get(Identifiers.REMOTE_URI_ID_PARAM);
        const uriHandle = url.searchParams.get(Identifiers.REMOTE_URI_HANDLE_PARAM);
        const extensionId =
            url.searchParams.get(Identifiers.REMOTE_URI_EXTENSION_ID_PARAM) ||
            getOwnerExtensionOfProviderHandle(id || '');
        if (id && uriHandle) {
            if (!extensionId) {
                throw new FailedToDetermineExtensionId(
                    `Unable to determine the extension id for the remote server handle', { ${id}, ${uriHandle} }`
                );
            }
            return { handle: uriHandle, id, extensionId };
        }
        throw new Error('Invalid remote URI');
    } catch (ex) {
        if (ex instanceof FailedToDetermineExtensionId) {
            throw ex;
        }
        throw new Error(`'Failed to parse remote URI ${getSafeUrlForLogging(uri)}`);
    }
}

function getSafeUrlForLogging(uri: string) {
    if ((uri || '').trim().toLowerCase().startsWith(Identifiers.REMOTE_URI.toLowerCase())) {
        return uri;
    } else {
        try {
            const url: URL = new URL(uri);
            const isLocalHost = url.hostname.toLocaleLowerCase() === 'localhost' || url.hostname === '127.0.0.1';
            return `${url.protocol}//${isLocalHost ? url.hostname : '<REMOTE SERVER>'}:${url.port}`;
        } catch {
            return uri;
        }
    }
}

export function getOwnerExtensionOfProviderHandle(id: string) {
    if (!id) {
        return;
    }
    if (isBuiltInJupyterProvider(id)) {
        return JVSC_EXTENSION_ID;
    }
    if (id.startsWith('azureml_compute_instances') || id.startsWith('azureml_connected_compute_instances')) {
        return 'ms-toolsai.vscode-ai';
    }
    if (id === 'github-codespaces') {
        return 'GitHub.codespaces';
    }
    traceWarning(`Extension Id not found for server Id ${id}`);
}
