// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../platform/common/extensions';
import * as hashjs from 'hash.js';
import * as path from '../../platform/vscode-path/path';
import { ConfigurationTarget, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import { noop } from '../../platform/common/utils/misc';
import { IJupyterConnection } from '../types';
import { IJupyterServerUri } from './types';
import { getJupyterConnectionDisplayName } from './launcher/helpers';
import { IConfigurationService, IWatchableJupyterSettings, Resource } from '../../platform/common/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { DataScience } from '../../platform/common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../../platform/common/constants';

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

        // Special case for URI's ending with 'lab'. Remove this from the URI. This is not
        // the location for connecting to jupyterlab
        if (url.pathname === '/lab') {
            uri = uri.replace('lab', '');
        }
        url = new URL(uri);
    } catch (err) {
        // This should already have been parsed when set, so just throw if it's not right here
        throw err;
    }

    const serverUri = getJupyterServerUri(uri);
    const baseUrl = serverUri ? serverUri.baseUrl : `${url.protocol}//${url.host}${url.pathname}`;
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

export function computeUriHash(uri: string) {
    return hashjs.sha256().update(uri).digest('hex');
}
