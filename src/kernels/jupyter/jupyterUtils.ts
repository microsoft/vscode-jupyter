// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import { ConfigurationTarget } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import { JupyterServerProviderHandle } from './types';
import { isBuiltInJupyterServerProvider } from './helpers';
import { IConfigurationService, IWatchableJupyterSettings, Resource } from '../../platform/common/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { DataScience } from '../../platform/common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { JVSC_EXTENSION_ID, Telemetry } from '../../platform/common/constants';
import { computeHash } from '../../platform/common/crypto';

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

export async function computeServerId(serverHandle: JupyterServerProviderHandle) {
    const uri = jupyterServerHandleToString(serverHandle);
    return computeHash(uri, 'SHA-256');
}

const OLD_EXTENSION_ID_THAT_DID_NOT_HAVE_EXT_ID_IN_URL = ['ms-toolsai.jupyter', 'ms-toolsai.vscode-ai'];
const REMOTE_URI = 'https://remote/';
const REMOTE_URI_ID_PARAM = 'id';
const REMOTE_URI_HANDLE_PARAM = 'uriHandle';
const REMOTE_URI_EXTENSION_ID_PARAM = 'extensionId';

export function jupyterServerHandleToString(serverHandle: JupyterServerProviderHandle) {
    if (OLD_EXTENSION_ID_THAT_DID_NOT_HAVE_EXT_ID_IN_URL.includes(serverHandle.extensionId)) {
        // Jupyter extension and AzML extension did not have extension id in the generated Id.
        // Hence lets not store them in the future as well, however
        // for all other extensions we will (it will only break the MRU for a few set of users using other extensions that contribute Jupyter servers via Jupyter extension).
        return `${REMOTE_URI}?${REMOTE_URI_ID_PARAM}=${serverHandle.id}&${REMOTE_URI_HANDLE_PARAM}=${encodeURI(
            serverHandle.handle
        )}`;
    }
    return `${REMOTE_URI}?${REMOTE_URI_ID_PARAM}=${serverHandle.id}&${REMOTE_URI_HANDLE_PARAM}=${encodeURI(
        serverHandle.handle
    )}&${REMOTE_URI_EXTENSION_ID_PARAM}=${encodeURI(serverHandle.extensionId)}`;
}

export function jupyterServerHandleFromString(serverHandleId: string): JupyterServerProviderHandle {
    try {
        const url: URL = new URL(serverHandleId);

        // Id has to be there too.
        const id = url.searchParams.get(REMOTE_URI_ID_PARAM) || '';
        const uriHandle = url.searchParams.get(REMOTE_URI_HANDLE_PARAM);
        let extensionId = url.searchParams.get(REMOTE_URI_EXTENSION_ID_PARAM);
        extensionId =
            extensionId ||
            // We know the extension ids for some of the providers.
            // This is for backward compatibility (with data from old versions of the extension).
            (isBuiltInJupyterServerProvider(id)
                ? JVSC_EXTENSION_ID
                : id.startsWith('azureml_compute_instances') || id.startsWith('azureml_connected_compute_instances')
                ? 'ms-toolsai.vscode-ai'
                : '');
        if (id && uriHandle && extensionId) {
            return { handle: uriHandle, id, extensionId };
        }
        throw new Error('Invalid remote URI');
    } catch (ex) {
        throw new Error(`'Failed to parse remote URI ${serverHandleId}`);
    }
}
