// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { isNil } from 'lodash';
import { EventEmitter, QuickPickItem, ThemeIcon, Uri } from 'vscode';
import { IApplicationShell, IClipboard } from '../../platform/common/application/types';
import { Settings } from '../../platform/common/constants';
import { traceDecoratorError, traceError } from '../../platform/logging';
import { DataScience } from '../../platform/common/utils/localize';
import {
    IMultiStepInputFactory,
    IMultiStepInput,
    InputStep,
    IQuickPickParameters,
    InputFlowAction
} from '../../platform/common/utils/multiStepInput';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry, Identifiers } from '../../webviews/webview-side/common/constants';
import {
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    IJupyterServerUriStorage,
    JupyterServerUriHandle
} from './types';
import { IDataScienceErrorHandler, WrappedError } from '../../platform/errors/types';
import { handleCertsError } from './jupyterUtils';
import { IConfigurationService } from '../../platform/common/types';
import { JupyterConnection } from './jupyterConnection';

const defaultUri = 'https://hostname:8080/?token=849d61a414abafab97bc4aab1f3547755ddc232c2b8cb7fe';

interface ISelectUriQuickPickItem extends QuickPickItem {
    newChoice: boolean;
    provider?: IJupyterUriProvider;
    url?: string;
}
export type SelectJupyterUriCommandSource =
    | 'nonUser'
    | 'toolbar'
    | 'commandPalette'
    | 'nativeNotebookStatusBar'
    | 'nativeNotebookToolbar'
    | 'prompt';
@injectable()
export class JupyterServerSelector {
    private readonly localLabel = `$(zap) ${DataScience.jupyterSelectURINoneLabel()}`;
    private readonly newLabel = `$(server) ${DataScience.jupyterSelectURINewLabel()}`;
    private readonly remoteLabel = `$(server) ${DataScience.jupyterSelectURIRemoteLabel()}`;
    constructor(
        @inject(IClipboard) private readonly clipboard: IClipboard,
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(IJupyterUriProviderRegistration)
        private extraUriProviders: IJupyterUriProviderRegistration,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDataScienceErrorHandler)
        private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection
    ) {}

    @captureTelemetry(Telemetry.SelectJupyterURI)
    @traceDecoratorError('Failed to select Jupyter Uri')
    public selectJupyterURI(
        allowLocal: boolean,
        commandSource: SelectJupyterUriCommandSource = 'nonUser'
    ): Promise<void> {
        sendTelemetryEvent(Telemetry.SetJupyterURIUIDisplayed, undefined, {
            commandSource
        });
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(this.startSelectingURI.bind(this, allowLocal), {});
    }
    @captureTelemetry(Telemetry.SetJupyterURIToLocal)
    public async setJupyterURIToLocal(): Promise<void> {
        await this.serverUriStorage.setUri(Settings.JupyterServerLocalLaunch);
    }

    public async setJupyterURIToRemote(userURI: string): Promise<void> {
        // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
        try {
            await this.jupyterConnection.validateRemoteUri(userURI);
        } catch (err) {
            if (err.message.indexOf('reason: self signed certificate') >= 0) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return;
                }
            } else {
                await this.errorHandler.handleError(
                    WrappedError.from(DataScience.jupyterNotebookRemoteConnectFailed().format(userURI, err), err)
                );
                // Can't set the URI in this case.
                return;
            }
        }

        await this.serverUriStorage.setUri(userURI);
        await this.serverUriStorage.addToUriList(userURI, Date.now(), userURI);

        // Indicate setting a jupyter URI to a remote setting. Check if an azure remote or not
        sendTelemetryEvent(Telemetry.SetJupyterURIToUserSpecified, undefined, {
            azure: userURI.toLowerCase().includes('azure')
        });
    }

    private async startSelectingURI(
        allowLocal: boolean,
        input: IMultiStepInput<{}>,
        _state: {}
    ): Promise<InputStep<{}> | void> {
        // First step, show a quick pick to choose either the remote or the local.
        // newChoice element will be set if the user picked 'enter a new server'

        // Get the list of items and show what the current value is
        const currentUri = await this.serverUriStorage.getUri();
        const items = await this.getUriPickList(allowLocal, currentUri);
        const activeItem = items.find(
            (i) =>
                i.url === currentUri ||
                (i.label === this.localLabel && currentUri === Settings.JupyterServerLocalLaunch)
        );
        const currentValue =
            currentUri === Settings.JupyterServerLocalLaunch
                ? DataScience.jupyterSelectURINoneLabel()
                : activeItem?.label;
        const placeholder = currentValue // This will show at the top (current value really)
            ? DataScience.jupyterSelectURIQuickPickCurrent().format(currentValue)
            : DataScience.jupyterSelectURIQuickPickPlaceholder();

        let pendingUpdatesToUri = Promise.resolve();
        const onDidChangeItems = new EventEmitter<typeof items>();
        const item = await input.showQuickPick<ISelectUriQuickPickItem, IQuickPickParameters<ISelectUriQuickPickItem>>({
            placeholder,
            items,
            activeItem,
            title: allowLocal
                ? DataScience.jupyterSelectURIQuickPickTitle()
                : DataScience.jupyterSelectURIQuickPickTitleRemoteOnly(),
            onDidTriggerItemButton: (e) => {
                const url = e.item.url;
                if (url && e.button.tooltip === DataScience.removeRemoteJupyterServerEntryInQuickPick()) {
                    pendingUpdatesToUri = pendingUpdatesToUri.then(() =>
                        this.serverUriStorage.removeUri(url).catch((ex) => traceError('Failed to update Uri list', ex))
                    );
                    items.splice(items.indexOf(e.item), 1);
                    onDidChangeItems.fire(items.concat([]));
                }
            },
            onDidChangeItems: onDidChangeItems.event
        });
        await pendingUpdatesToUri.catch((ex) => traceError('Failed to update Uri list', ex));
        if (item.label === this.localLabel) {
            await this.setJupyterURIToLocal();
        } else if (!item.newChoice && !item.provider) {
            await this.setJupyterURIToRemote(!isNil(item.url) ? item.url : item.label);
        } else if (!item.provider) {
            return this.selectRemoteURI.bind(this);
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
            const uri = this.generateUriFromRemoteProvider(id, result);
            await this.setJupyterURIToRemote(uri);
        }
    }

    private generateUriFromRemoteProvider(id: string, result: JupyterServerUriHandle) {
        // eslint-disable-next-line
        return `${Identifiers.REMOTE_URI}?${Identifiers.REMOTE_URI_ID_PARAM}=${id}&${
            Identifiers.REMOTE_URI_HANDLE_PARAM
        }=${encodeURI(result)}`;
    }

    private async selectRemoteURI(input: IMultiStepInput<{}>, _state: {}): Promise<InputStep<{}> | void> {
        let initialValue = defaultUri;
        try {
            const text = await this.clipboard.readText().catch(() => '');
            const parsedUri = Uri.parse(text.trim(), true);
            // Only display http/https uris.
            initialValue = text && parsedUri && parsedUri.scheme.toLowerCase().startsWith('http') ? text : defaultUri;
        } catch {
            // We can ignore errors.
        }
        // Ask the user to enter a URI to connect to.
        const uri = await input.showInputBox({
            title: DataScience.jupyterSelectURIPrompt(),
            value: initialValue || defaultUri,
            validate: this.validateSelectJupyterURI,
            prompt: ''
        });

        if (uri) {
            await this.setJupyterURIToRemote(uri);
        }
    }

    private validateSelectJupyterURI = async (inputText: string): Promise<string | undefined> => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            new URL(inputText);

            // Double check http
            if (!inputText.toLowerCase().includes('http')) {
                throw new Error('Has to be http');
            }
        } catch {
            return DataScience.jupyterSelectURIInvalidURI();
        }
    };

    private async getUriPickList(allowLocal: boolean, currentUri: string): Promise<ISelectUriQuickPickItem[]> {
        // Ask our providers to stick on items
        let providerItems: ISelectUriQuickPickItem[] = [];
        const providers = await this.extraUriProviders.getProviders();
        if (providers) {
            providers.forEach((p) => {
                const newProviderItems = p.getQuickPickEntryItems().map((i) => {
                    return { ...i, newChoice: false, provider: p };
                });
                providerItems = providerItems.concat(newProviderItems);
            });
        }

        // Always have 'local' and 'add new'
        let items: ISelectUriQuickPickItem[] = [];
        if (allowLocal) {
            items.push({ label: this.localLabel, detail: DataScience.jupyterSelectURINoneDetail(), newChoice: false });
            items = items.concat(providerItems);
            items.push({ label: this.newLabel, detail: DataScience.jupyterSelectURINewDetail(), newChoice: true });
        } else {
            items = items.concat(providerItems);
            items.push({
                label: this.remoteLabel,
                detail: DataScience.jupyterSelectURIRemoteDetail(),
                newChoice: true
            });
        }

        // Get our list of recent server connections and display that as well
        const savedURIList = await this.serverUriStorage.getSavedUriList();
        savedURIList.forEach((uriItem) => {
            if (uriItem.uri) {
                const uriDate = new Date(uriItem.time);
                const isSelected = currentUri === uriItem.uri;
                items.push({
                    label: !isNil(uriItem.displayName) ? uriItem.displayName : uriItem.uri,
                    detail: DataScience.jupyterSelectURIMRUDetail().format(uriDate.toLocaleString()),
                    newChoice: false,
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
