// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import '../../platform/common/extensions';
import * as path from '../../platform/vscode-path/path';
import { ConfigurationTarget, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import { noop } from '../../platform/common/utils/misc';
import { IJupyterConnection } from '../types';
import { IJupyterServerUri, JupyterServerUriHandle } from './types';
import { getJupyterConnectionDisplayName } from './launcher/helpers';
import { IConfigurationService, IWatchableJupyterSettings, Resource } from '../../platform/common/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { DataScience } from '../../platform/common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Identifiers, Telemetry } from '../../platform/common/constants';
import { traceError } from '../../platform/logging';
const msrCrypto = require('../../platform/msrCrypto/msrCrypto');

// Use window crypto if it's available, otherwise use the msrCrypto module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalMsCrypto = (global?.window as any)?.msCrypto?.subtle?.digest
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global?.window as any)?.msCrypto
    : undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const windowCrypto = (global?.window as any)?.crypto?.subtle?.digest ? (global?.window as any)?.crypto : undefined;
const crypto = (globalMsCrypto || windowCrypto || msrCrypto) as Crypto;

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
    const enableOption: string = DataScience.jupyterSelfCertEnable();
    const closeOption: string = DataScience.jupyterSelfCertClose();
    const value = await appShell.showErrorMessage(
        DataScience.jupyterSelfCertFail().format(message),
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
    const enableOption: string = DataScience.jupyterSelfCertEnable();
    const closeOption: string = DataScience.jupyterSelfCertClose();
    const value = await appShell.showErrorMessage(
        DataScience.jupyterExpiredCertFail().format(message),
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

export function createRemoteConnectionInfo(
    uri: string,
    getJupyterServerUri: (uri: string) => IJupyterServerUri | undefined
): IJupyterConnection {
    let url: URL;
    try {
        url = new URL(uri);
    } catch (err) {
        // This should already have been parsed when set, so just throw if it's not right here
        throw err;
    }

    const serverUri = getJupyterServerUri(uri);

    const baseUrl = serverUri
        ? serverUri.baseUrl
        : // Special case for URI's ending with 'lab'. Remove this from the URI. This is not
          // the location for connecting to jupyterlab
          `${url.protocol}//${url.host}${url.pathname === '/lab' ? '' : url.pathname}`;
    const token = serverUri ? serverUri.token : `${url.searchParams.get('token')}`;
    const hostName = serverUri ? new URL(serverUri.baseUrl).hostname : url.hostname;

    return {
        type: 'jupyter',
        baseUrl,
        token,
        hostName,
        localLaunch: false,
        displayName:
            serverUri && serverUri.displayName
                ? serverUri.displayName
                : getJupyterConnectionDisplayName(token, baseUrl),
        disconnected: (_l) => {
            return { dispose: noop };
        },
        dispose: noop,
        rootDirectory: Uri.file(''),
        getAuthHeader: serverUri ? () => getJupyterServerUri(uri)?.authorizationHeader : undefined,
        url: uri
    };
}

export async function computeServerId(uri: string) {
    try {
        const inputBuffer = new TextEncoder().encode(uri);
        const hashBuffer = await crypto.subtle.digest({ name: 'SHA-256' }, inputBuffer);

        // Turn into hash string (got this logic from https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        traceError(`Failed to compute server id for ${uri}`, e);
        throw e;
    }
}

export function generateUriFromRemoteProvider(id: string, result: JupyterServerUriHandle) {
    // eslint-disable-next-line
    return `${Identifiers.REMOTE_URI}?${Identifiers.REMOTE_URI_ID_PARAM}=${id}&${
        Identifiers.REMOTE_URI_HANDLE_PARAM
    }=${encodeURI(result)}`;
}

export function extractJupyterServerHandleAndId(
    uri: string
): { handle: JupyterServerUriHandle; id: string } | undefined {
    const url: URL = new URL(uri);

    // Id has to be there too.
    const id = url.searchParams.get(Identifiers.REMOTE_URI_ID_PARAM);
    const uriHandle = url.searchParams.get(Identifiers.REMOTE_URI_HANDLE_PARAM);
    return id && uriHandle ? { handle: uriHandle, id } : undefined;
}
