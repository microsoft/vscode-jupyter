// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IJupyterServerProviderRegistry } from '../../../kernels/jupyter/types';
import { Telemetry } from '../../../platform/common/constants';
import { IServiceContainer } from '../../../platform/ioc/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { JupyterServerCollection, JupyterServerCommandProvider, JupyterServerProvider } from '../../../api';
import { stripCodicons } from '../../../platform/common/helpers';

export function createJupyterServerCollection(
    id: string,
    label: string,
    serverProvider: JupyterServerProvider,
    extensionId: string,
    serviceContainer: IServiceContainer
) {
    sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
        clientExtId: extensionId,
        pemUsed: 'createJupyterServerCollection'
    });
    const registration = serviceContainer.get<IJupyterServerProviderRegistry>(IJupyterServerProviderRegistry);
    const collection = registration.createJupyterServerCollection(
        extensionId,
        id,
        stripCodicons(label),
        serverProvider
    );

    // Omit PEMS that are only used for internal usage.
    // I.e. remove the unwanted PEMS and return the valid API to the extension.
    const proxy: Omit<JupyterServerCollection, 'onDidChangeProvider' | 'serverProvider' | 'extensionId'> = {
        dispose: () => {
            collection?.dispose();
        },
        get id() {
            return id;
        },
        set label(value: string) {
            collection.label = stripCodicons(value);
        },
        get label() {
            return collection.label;
        },
        set documentation(value: Uri | undefined) {
            collection.documentation = value;
        },
        get documentation() {
            return collection.documentation;
        },
        set commandProvider(value: JupyterServerCommandProvider | undefined) {
            collection.commandProvider = value;
        },
        get commandProvider() {
            return collection.commandProvider;
        }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return proxy as any;
}
