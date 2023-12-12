// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ServerConnection } from '@jupyterlab/services';
import * as path from '../../platform/vscode-path/path';
import { ConfigurationTarget, Uri, window } from 'vscode';
import { IJupyterConnection } from '../types';
import { getJupyterConnectionDisplayName } from './helpers';
import { IConfigurationService, IDisposable, IWatchableJupyterSettings, Resource } from '../../platform/common/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { DataScience } from '../../platform/common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Identifiers, JVSC_EXTENSION_ID, Telemetry, isBuiltInJupyterProvider } from '../../platform/common/constants';
import { computeHash } from '../../platform/common/crypto';
import { IJupyterServerUri } from '../../api';
import { traceWarning } from '../../platform/logging';
import { IJupyterRequestAgentCreator, IJupyterRequestCreator, JupyterServerProviderHandle } from './types';

export function expandWorkingDir(
    workingDir: string | undefined,
    launchingFile: Resource,
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

    return process.cwd();
}

export async function handleSelfCertsError(config: IConfigurationService, message: string): Promise<boolean> {
    // On a self cert error, warn the user and ask if they want to change the setting
    const enableOption: string = DataScience.jupyterSelfCertEnable;
    const closeOption: string = DataScience.jupyterSelfCertClose;
    const value = await window.showErrorMessage(
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

export async function handleExpiredCertsError(config: IConfigurationService, message: string): Promise<boolean> {
    // On a self cert error, warn the user and ask if they want to change the setting
    const enableOption: string = DataScience.jupyterSelfCertEnable;
    const closeOption: string = DataScience.jupyterSelfCertClose;
    const value = await window.showErrorMessage(
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

export function createJupyterConnectionInfo(
    jupyterHandle: JupyterServerProviderHandle,
    serverUri: IJupyterServerUri,
    requestCreator: IJupyterRequestCreator,
    requestAgentCreator: IJupyterRequestAgentCreator | undefined,
    configService: IConfigurationService,
    rootDirectory: Uri,
    toDispose?: IDisposable
): IJupyterConnection {
    const baseUrl = serverUri.baseUrl;
    const token = serverUri.token;
    const hostName = new URL(serverUri.baseUrl).hostname;
    const authHeader =
        serverUri.authorizationHeader && Object.keys(serverUri?.authorizationHeader ?? {}).length > 0
            ? serverUri.authorizationHeader
            : undefined;
    const getAuthHeader = authHeader ? () => authHeader : undefined;

    let serverSettings: Partial<ServerConnection.ISettings> = {
        baseUrl,
        appUrl: '',
        // A web socket is required to allow token authentication
        wsUrl: baseUrl.replace('http', 'ws'),
        fetch: serverUri.fetch,
        WebSocket: serverUri.WebSocket
    };

    // Agent is allowed to be set on this object, but ts doesn't like it on RequestInit, so any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let requestInit: any = requestCreator.getRequestInit();

    const isTokenEmpty = token === '' || token === 'null';
    if (!isTokenEmpty || getAuthHeader) {
        serverSettings = { ...serverSettings, token, appendToken: true };
    }

    const allowUnauthorized = configService.getSettings(undefined).allowUnauthorizedRemoteConnection;
    // If this is an https connection and we want to allow unauthorized connections set that option on our agent
    // we don't need to save the agent as the previous behaviour is just to create a temporary default agent when not specified
    if (baseUrl.startsWith('https') && allowUnauthorized && requestAgentCreator) {
        const requestAgent = requestAgentCreator.createHttpRequestAgent();
        requestInit = { ...requestInit, agent: requestAgent };
    }

    const { ServerConnection } = require('@jupyterlab/services');
    // This replaces the WebSocket constructor in jupyter lab services with our own implementation
    // See _createSocket here:
    // https://github.com/jupyterlab/jupyterlab/blob/cfc8ebda95e882b4ed2eefd54863bb8cdb0ab763/packages/services/src/kernel/default.ts
    serverSettings = {
        ...serverSettings,
        init: requestInit,
        WebSocket: serverUri.WebSocket
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              requestCreator.wrapWebSocketCtor(serverUri.WebSocket as any)
            : (requestCreator.getWebsocketCtor(
                  undefined,
                  allowUnauthorized,
                  getAuthHeader
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ) as any),
        fetch: serverUri.fetch || requestCreator.getFetchMethod(),
        Request: requestCreator.getRequestCtor(undefined, allowUnauthorized, getAuthHeader),
        Headers: requestCreator.getHeadersCtor()
    };

    const connection: IJupyterConnection = {
        baseUrl,
        providerId: jupyterHandle.id,
        serverProviderHandle: jupyterHandle,
        token,
        hostName,
        displayName:
            serverUri && serverUri.displayName
                ? serverUri.displayName
                : getJupyterConnectionDisplayName(token, baseUrl),
        dispose: () => toDispose?.dispose(),
        rootDirectory,
        // For remote jupyter servers that are managed by us, we can provide the auth header.
        // Its crucial this is set to undefined, else password retrieval will not be attempted.
        getAuthHeader,
        settings: ServerConnection.makeSettings(serverSettings)
    };
    return connection;
}

export async function computeServerId(provider: JupyterServerProviderHandle) {
    const uri = generateIdFromRemoteProvider(provider);
    return computeHash(uri, 'SHA-256');
}

const ExtensionsWithKnownProviderIds = new Set(
    [JVSC_EXTENSION_ID, 'ms-toolsai.vscode-ai', 'GitHub.codespaces'].map((e) => e.toLowerCase())
);

export function generateIdFromRemoteProvider(provider: JupyterServerProviderHandle) {
    if (ExtensionsWithKnownProviderIds.has(provider.extensionId.toLowerCase())) {
        // This is done to maintain backwards compatibility, as the old Ids
        // did not have extension Ids in the urls, and we need to ensure we stick with that, else
        // if this change, then the kernle ids generated for controller ids will be different, meaning kernel MRUs stop working

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
