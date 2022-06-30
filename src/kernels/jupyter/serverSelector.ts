// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import isNil = require('lodash/isNil');
import { EventEmitter, QuickPickItem, ThemeIcon } from 'vscode';
import { IApplicationShell } from '../../platform/common/application/types';
import { traceDecoratorError, traceError, traceWarning } from '../../platform/logging';
import { DataScience } from '../../platform/common/utils/localize';
import {
    IMultiStepInputFactory,
    IMultiStepInput,
    InputStep,
    IQuickPickParameters,
    InputFlowAction
} from '../../platform/common/utils/multiStepInput';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../../telemetry';
import {
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    IJupyterServerUriStorage,
    JupyterServerUriHandle
} from './types';
import { IDataScienceErrorHandler } from '../errors/types';
import { IConfigurationService, IsWebExtension } from '../../platform/common/types';
import {
    handleExpiredCertsError,
    handleSelfCertsError,
    computeServerId,
    generateUriFromRemoteProvider
} from './jupyterUtils';
import { JupyterConnection } from './jupyterConnection';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError';
import { RemoteJupyterServerConnectionError } from '../../platform/errors/remoteJupyterServerConnectionError';
import { JupyterSelfCertsExpiredError } from '../../platform/errors/jupyterSelfCertsExpiredError';

interface ISelectUriQuickPickItem extends QuickPickItem {
    provider?: IJupyterUriProvider;
    url?: string;
}
export type SelectJupyterUriCommandSource =
    | 'nonUser'
    | 'toolbar'
    | 'commandPalette'
    | 'nativeNotebookStatusBar'
    | 'nativeNotebookToolbar'
    | 'errorHandler'
    | 'prompt';
@injectable()
export class JupyterServerSelector {
    constructor(
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(IJupyterUriProviderRegistration)
        private extraUriProviders: IJupyterUriProviderRegistration,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDataScienceErrorHandler)
        private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IsWebExtension) private readonly isWebExtension: boolean
    ) {}

    @captureTelemetry(Telemetry.SelectJupyterURI)
    public selectJupyterURI(
        commandSource: SelectJupyterUriCommandSource = 'nonUser',
        existingMultiStep?: IMultiStepInput<{}>
    ): Promise<InputFlowAction | undefined | InputStep<{}> | void> {
        sendTelemetryEvent(Telemetry.SetJupyterURIUIDisplayed, undefined, {
            commandSource
        });
        if (existingMultiStep) {
            return this.startSelectingURI(existingMultiStep, {});
        } else {
            const multiStep = this.multiStepFactory.create<{}>();
            return multiStep.run(this.startSelectingURI.bind(this), {});
        }
    }

    @captureTelemetry(Telemetry.SetJupyterURIToLocal)
    public async setJupyterURIToLocal(): Promise<void> {
        await this.serverUriStorage.setUriToLocal();
    }

    @captureTelemetry(Telemetry.EnterJupyterURI)
    @traceDecoratorError('Failed to enter Jupyter Uri')
    public async setJupyterURIToRemote(userURI: string, ignoreValidation?: boolean): Promise<void> {
        // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
        try {
            if (!ignoreValidation) {
                await this.jupyterConnection.validateRemoteUri(userURI);
            }
        } catch (err) {
            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleSelfCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return;
                }
            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleExpiredCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return;
                }
            } else {
                if (err.message.includes('Failed to fetch') && this.isWebExtension) {
                    sendTelemetryEvent(Telemetry.FetchError, undefined, { currentTask: 'connecting' });
                }
                await this.errorHandler.handleError(
                    new RemoteJupyterServerConnectionError(userURI, computeServerId(userURI), err)
                );
                // Can't set the URI in this case.
                return;
            }
        }

        const connection = await this.jupyterConnection.createConnectionInfo({ uri: userURI });
        await this.serverUriStorage.setUriToRemote(userURI, connection.displayName);

        // Indicate setting a jupyter URI to a remote setting. Check if an azure remote or not
        sendTelemetryEvent(Telemetry.SetJupyterURIToUserSpecified, undefined, {
            azure: userURI.toLowerCase().includes('azure')
        });
    }

    private async startSelectingURI(input: IMultiStepInput<{}>, _state: {}): Promise<InputStep<{}> | void> {
        // First step, show a quick pick to choose either the remote or the local.
        // newChoice element will be set if the user picked 'enter a new server'

        // Get the list of items and show what the current value is
        const remoteUri = await this.serverUriStorage.getRemoteUri();
        const items = await this.getUriPickList(remoteUri);
        const activeItem = items.find((i) => i.url === remoteUri);
        const currentValue = !remoteUri ? DataScience.jupyterSelectURINoneLabel() : activeItem?.label;
        const placeholder = currentValue // This will show at the top (current value really)
            ? DataScience.jupyterSelectURIQuickPickCurrent().format(currentValue)
            : DataScience.jupyterSelectURIQuickPickPlaceholder();

        let pendingUpdatesToUri = Promise.resolve();
        const onDidChangeItems = new EventEmitter<typeof items>();
        const item = await input.showQuickPick<ISelectUriQuickPickItem, IQuickPickParameters<ISelectUriQuickPickItem>>({
            placeholder,
            items,
            activeItem,
            acceptFilterBoxTextAsSelection: true,
            validate: this.validateSelectJupyterURI.bind(this),
            title: DataScience.jupyterSelectURIQuickPickTitle(),
            onDidTriggerItemButton: (e) => {
                const url = e.item.url;
                if (url && e.button.tooltip === DataScience.removeRemoteJupyterServerEntryInQuickPick()) {
                    pendingUpdatesToUri = pendingUpdatesToUri.then(() =>
                        this.serverUriStorage.removeUri(url).catch((ex) => traceError('Failed to update Uri list', ex))
                    );
                    items.splice(items.indexOf(e.item), 1);
                    onDidChangeItems.fire(items.concat([]));
                } else if (e.button) {
                    throw InputFlowAction.back;
                }
            },
            onDidChangeItems: onDidChangeItems.event
        });
        await pendingUpdatesToUri.catch((ex) => traceError('Failed to update Uri list', ex));
        if (typeof item === 'string') {
            await this.setJupyterURIToRemote(item);
        } else if (!item.provider) {
            await this.setJupyterURIToRemote(!isNil(item.url) ? item.url : item.label);
        } else {
            return this.selectProviderURI.bind(this, item.provider, item);
        }
    }

    private async selectProviderURI(
        provider: IJupyterUriProvider,
        item: ISelectUriQuickPickItem,
        _input: IMultiStepInput<{}>,
        _state: {}
    ): Promise<InputStep<{}> | void> {
        if (!provider.handleQuickPick) {
            return;
        }
        const result = await provider.handleQuickPick(item, true);
        if (result === 'back') {
            throw InputFlowAction.back;
        }
        if (result) {
            await this.handleProviderQuickPick(provider.id, result);
        }
    }
    private async handleProviderQuickPick(id: string, result: JupyterServerUriHandle | undefined) {
        if (result) {
            const uri = generateUriFromRemoteProvider(id, result);
            await this.setJupyterURIToRemote(uri);
        }
    }

    public validateSelectJupyterURI = async (inputText: string): Promise<string | undefined> => {
        inputText = inputText.trim();
        try {
            new URL(inputText);
        } catch {
            return DataScience.jupyterSelectURIInvalidURI();
        }

        // Double check http
        if (!inputText.toLowerCase().startsWith('http')) {
            return DataScience.validationErrorMessageForRemoteUrlProtocolNeedsToBeHttpOrHttps();
        }
        // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
        try {
            await this.jupyterConnection.validateRemoteUri(inputText);
        } catch (err) {
            traceWarning('Uri verification error', err);
            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleSelfCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return DataScience.jupyterSelfCertFailErrorMessageOnly();
                }
            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleExpiredCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return DataScience.jupyterSelfCertExpiredErrorMessageOnly();
                }
            } else if (!this.isWebExtension) {
                return DataScience.remoteJupyterConnectionFailedWithoutServerWithError().format(
                    err.message || err.toString()
                );
            } else {
                return DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb().format(
                    err.message || err.toString()
                );
            }
        }
    };

    private async getUriPickList(currentRemoteUri?: string): Promise<ISelectUriQuickPickItem[]> {
        // Ask our providers to stick on items
        let providerItems: ISelectUriQuickPickItem[] = [];
        const providers = await this.extraUriProviders.getProviders();
        if (providers) {
            providers.forEach((p) => {
                if (!p.getQuickPickEntryItems) {
                    return;
                }
                const newProviderItems = p.getQuickPickEntryItems().map((i) => {
                    return { ...i, newChoice: false, provider: p };
                });
                providerItems = providerItems.concat(newProviderItems);
            });
        }

        let items: ISelectUriQuickPickItem[] = [...providerItems];

        // Get our list of recent server connections and display that as well
        const savedURIList = await this.serverUriStorage.getSavedUriList();
        savedURIList.forEach((uriItem) => {
            if (uriItem.uri) {
                const uriDate = new Date(uriItem.time);
                const isSelected = currentRemoteUri === uriItem.uri;
                items.push({
                    label: !isNil(uriItem.displayName) ? uriItem.displayName : uriItem.uri,
                    detail: DataScience.jupyterSelectURIMRUDetail().format(uriDate.toLocaleString()),
                    url: uriItem.uri,
                    buttons: isSelected
                        ? [] // Cannot delete the current Uri (you can only switch to local).
                        : [
                              {
                                  iconPath: new ThemeIcon('trash'),
                                  tooltip: DataScience.removeRemoteJupyterServerEntryInQuickPick()
                              }
                          ]
                });
            }
        });

        return items;
    }
}
