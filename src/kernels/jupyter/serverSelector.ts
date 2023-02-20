// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-use-before-define */

import { inject, injectable } from 'inversify';
import { EventEmitter, QuickPickItem, ThemeIcon, Uri } from 'vscode';
import { IApplicationShell, IClipboard, IWorkspaceService } from '../../platform/common/application/types';
import { traceDecoratorError, traceError, traceWarning } from '../../platform/logging';
import { DataScience } from '../../platform/common/utils/localize';
import {
    IMultiStepInputFactory,
    IMultiStepInput,
    InputStep,
    IQuickPickParameters,
    InputFlowAction
} from '../../platform/common/utils/multiStepInput';
import { capturePerfTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../../telemetry';
import {
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    IJupyterServerUriStorage,
    JupyterServerUriHandle,
    IJupyterServerUriEntry
} from './types';
import { IDataScienceErrorHandler } from '../errors/types';
import {
    IConfigurationService,
    IDisposableRegistry,
    IFeaturesManager,
    IsWebExtension,
    KernelPickerType
} from '../../platform/common/types';
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

const defaultUri = 'https://hostname:8080/?token=849d61a414abafab97bc4aab1f3547755ddc232c2b8cb7fe';
interface ISelectUriQuickPickItem extends QuickPickItem {
    newChoice?: boolean;
    provider?: IJupyterUriProvider;
    url?: string;
}

interface IJupyterServerSelector {
    selectJupyterURI(
        commandSource: SelectJupyterUriCommandSource,
        existingMultiStep?: IMultiStepInput<{}>
    ): Promise<InputFlowAction | undefined | InputStep<{}> | void>;

    setJupyterURIToLocal(): Promise<void>;
    setJupyterURIToRemote(userURI: string | undefined, ignoreValidation?: boolean, displayName?: string): Promise<void>;
}

export type SelectJupyterUriCommandSource =
    | 'nonUser'
    | 'toolbar'
    | 'commandPalette'
    | 'nativeNotebookStatusBar'
    | 'nativeNotebookToolbar'
    | 'errorHandler'
    | 'prompt';

export async function validateSelectJupyterURI(
    jupyterConnection: JupyterConnection,
    applicationShell: IApplicationShell,
    configService: IConfigurationService,
    isWebExtension: boolean,
    inputText: string
): Promise<string | undefined> {
    inputText = inputText.trim();
    try {
        new URL(inputText);
    } catch {
        return DataScience.jupyterSelectURIInvalidURI;
    }

    // Double check http
    if (!inputText.toLowerCase().startsWith('http')) {
        return DataScience.validationErrorMessageForRemoteUrlProtocolNeedsToBeHttpOrHttps;
    }
    // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
    try {
        await jupyterConnection.validateRemoteUri(inputText);
    } catch (err) {
        traceWarning('Uri verification error', err);
        if (JupyterSelfCertsError.isSelfCertsError(err)) {
            sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
            const handled = await handleSelfCertsError(applicationShell, configService, err.message);
            if (!handled) {
                return DataScience.jupyterSelfCertFailErrorMessageOnly;
            }
        } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
            sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
            const handled = await handleExpiredCertsError(applicationShell, configService, err.message);
            if (!handled) {
                return DataScience.jupyterSelfCertExpiredErrorMessageOnly;
            }
        } else {
            // Return the general connection error to show in the validation box
            // Replace any Urls in the error message with markdown link.
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const errorMessage = (err.message || err.toString()).replace(urlRegex, (url: string) => `[${url}](${url})`);
            return (
                isWebExtension || true
                    ? DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                    : DataScience.remoteJupyterConnectionFailedWithoutServerWithError
            )(errorMessage);
        }
    }
}

/**
 * Provides the UI for picking a remote server. Multiplexes to one of two implementations based on the 'showOnlyOneTypeOfKernel' experiment.
 */
@injectable()
export class JupyterServerSelector {
    private impl: IJupyterServerSelector;
    private implType?: KernelPickerType;
    constructor(
        @inject(IClipboard) private readonly clipboard: IClipboard,
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(IJupyterUriProviderRegistration)
        private readonly extraUriProviders: IJupyterUriProviderRegistration,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDataScienceErrorHandler)
        private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(IWorkspaceService) readonly workspaceService: IWorkspaceService,
        @inject(IDisposableRegistry) readonly disposableRegistry: IDisposableRegistry,
        @inject(IFeaturesManager) featuresManager: IFeaturesManager
    ) {
        this.createImpl(featuresManager.features.kernelPickerType);
        this.disposableRegistry.push(
            featuresManager.onDidChangeFeatures(() => {
                // Create impl will ignore if the setting has not changed
                this.createImpl(featuresManager.features.kernelPickerType);
            })
        );
    }

    public selectJupyterURI(
        commandSource: SelectJupyterUriCommandSource = 'nonUser',
        existingMultiStep?: IMultiStepInput<{}>
    ): Promise<InputFlowAction | undefined | InputStep<{}> | void> {
        return this.impl.selectJupyterURI(commandSource, existingMultiStep);
    }

    public setJupyterURIToLocal(): Promise<void> {
        return this.impl.setJupyterURIToLocal();
    }

    public setJupyterURIToRemote(
        userURI: string | undefined,
        ignoreValidation?: boolean,
        displayName?: string
    ): Promise<void> {
        return this.impl.setJupyterURIToRemote(userURI, ignoreValidation, displayName);
    }

    private createImpl(kernelPickerType: KernelPickerType) {
        if (kernelPickerType === 'Stable' && this.implType !== 'Stable') {
            this.impl = new JupyterServerSelector_Original(
                this.clipboard,
                this.multiStepFactory,
                this.extraUriProviders,
                this.serverUriStorage,
                this.errorHandler,
                this.applicationShell,
                this.configService,
                this.jupyterConnection,
                this.isWebExtension
            );
            this.implType = 'Stable';
        } else if (kernelPickerType === 'Insiders' && this.implType !== 'Insiders') {
            this.impl = new JupyterServerSelector_Insiders(
                this.clipboard,
                this.multiStepFactory,
                this.extraUriProviders,
                this.serverUriStorage,
                this.errorHandler,
                this.applicationShell,
                this.configService,
                this.jupyterConnection,
                this.isWebExtension
            );
            this.implType = 'Insiders';
        }
    }
}

/**
 * Original version of the JupyterServerSelector. This class will hopefully be fully deletable when the experiment is proven.
 */
class JupyterServerSelector_Original implements IJupyterServerSelector {
    private readonly localLabel = `$(zap) ${DataScience.jupyterSelectURINoneLabel}`;
    private readonly newLabel = `$(server) ${DataScience.jupyterSelectURINewLabel}`;
    private readonly remoteLabel = `$(server) ${DataScience.jupyterSelectURIRemoteLabel}`;
    constructor(
        private readonly clipboard: IClipboard,
        private readonly multiStepFactory: IMultiStepInputFactory,
        private extraUriProviders: IJupyterUriProviderRegistration,
        private readonly serverUriStorage: IJupyterServerUriStorage,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly applicationShell: IApplicationShell,
        private readonly configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IsWebExtension) private readonly isWebExtension: boolean
    ) {}

    @capturePerfTelemetry(Telemetry.SelectJupyterURI)
    @traceDecoratorError('Failed to select Jupyter Uri')
    public selectJupyterURI(
        commandSource: SelectJupyterUriCommandSource = 'nonUser'
    ): Promise<InputFlowAction | undefined | InputStep<{}> | void> {
        const allowLocal = commandSource !== 'nonUser';
        sendTelemetryEvent(Telemetry.SetJupyterURIUIDisplayed, undefined, {
            commandSource
        });
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(this.startSelectingURI.bind(this, allowLocal), {});
    }

    @capturePerfTelemetry(Telemetry.SetJupyterURIToLocal)
    public async setJupyterURIToLocal(): Promise<void> {
        await this.serverUriStorage.setUriToLocal();
    }

    public async setJupyterURIToRemote(
        userURI: string,
        ignoreValidation?: boolean,
        displayName?: string
    ): Promise<void> {
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
                const serverId = await computeServerId(userURI);
                await this.errorHandler.handleError(new RemoteJupyterServerConnectionError(userURI, serverId, err));
                // Can't set the URI in this case.
                return;
            }
        }

        const connection = await this.jupyterConnection.createConnectionInfo({ uri: userURI });
        displayName && (connection.displayName = displayName);
        await this.serverUriStorage.setUriToRemote(userURI, connection.displayName);

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
        const remoteUri = await this.serverUriStorage.getRemoteUri();
        const items = await this.getUriPickList(allowLocal, remoteUri);
        const activeItem = items.find((i) => i.url === remoteUri || (i.label === this.localLabel && !remoteUri));
        const currentValue = !remoteUri ? DataScience.jupyterSelectURINoneLabel : activeItem?.label;
        const placeholder = currentValue // This will show at the top (current value really)
            ? DataScience.jupyterSelectURIQuickPickCurrent(currentValue)
            : DataScience.jupyterSelectURIQuickPickPlaceholder;

        let pendingUpdatesToUri = Promise.resolve();
        const onDidChangeItems = new EventEmitter<typeof items>();
        const item = await input.showQuickPick<ISelectUriQuickPickItem, IQuickPickParameters<ISelectUriQuickPickItem>>({
            placeholder,
            items,
            activeItem,
            title: allowLocal
                ? DataScience.jupyterSelectURIQuickPickTitleOld
                : DataScience.jupyterSelectURIQuickPickTitleRemoteOnly,
            onDidTriggerItemButton: (e) => {
                const url = e.item.url;
                if (url && e.button.tooltip === DataScience.removeRemoteJupyterServerEntryInQuickPick) {
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
            await this.setJupyterURIToRemote(item.url || item.label, false, item.label);
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
            title: DataScience.jupyterSelectURIPrompt,
            value: initialValue || defaultUri,
            validate: validateSelectJupyterURI.bind(
                this,
                this.jupyterConnection,
                this.applicationShell,
                this.configService,
                this.isWebExtension
            ),
            prompt: ''
        });

        // Offer the user a chance to pick a display name for the server
        // Leaving it blank will use the URI as the display name
        const newDisplayName = await this.applicationShell.showInputBox({
            title: DataScience.jupyterRenameServer
        });

        if (uri) {
            await this.setJupyterURIToRemote(uri, true, newDisplayName || uri);
        }
    }

    private async getUriPickList(
        allowLocal: boolean,
        currentRemoteUri?: IJupyterServerUriEntry
    ): Promise<ISelectUriQuickPickItem[]> {
        // Ask our providers to stick on items
        let providerItems: ISelectUriQuickPickItem[] = [];
        const providers = await this.extraUriProviders.getProviders();
        if (providers) {
            for (const p of providers) {
                if (p.getQuickPickEntryItems && p.handleQuickPick) {
                    const items = await p.getQuickPickEntryItems();
                    const newProviderItems = items.map((i) => {
                        return { ...i, newChoice: false, provider: p };
                    });
                    providerItems = providerItems.concat(newProviderItems);
                }
            }
        }

        // Always have 'local' and 'add new'
        let items: ISelectUriQuickPickItem[] = [];
        if (allowLocal) {
            items.push({ label: this.localLabel, detail: DataScience.jupyterSelectURINoneDetail, newChoice: false });
            items = items.concat(providerItems);
            items.push({ label: this.newLabel, detail: DataScience.jupyterSelectURINewDetail, newChoice: true });
        } else {
            items = items.concat(providerItems);
            items.push({
                label: this.remoteLabel,
                detail: DataScience.jupyterSelectURIRemoteDetail,
                newChoice: true
            });
        }

        // Get our list of recent server connections and display that as well
        const savedURIList = await this.serverUriStorage.getSavedUriList();
        savedURIList.forEach((uriItem) => {
            if (uriItem.uri && uriItem.isValidated) {
                const uriDate = new Date(uriItem.time);
                const isSelected = currentRemoteUri?.uri === uriItem.uri;
                items.push({
                    label: uriItem.displayName || uriItem.uri,
                    detail: DataScience.jupyterSelectURIMRUDetail(uriDate),
                    // If our display name is not the same as the URI, render the uri as description
                    description: uriItem.displayName !== uriItem.uri ? uriItem.uri : undefined,
                    newChoice: false,
                    url: uriItem.uri,
                    buttons: isSelected
                        ? [] // Cannot delete the current Uri (you can only switch to local).
                        : [
                              {
                                  iconPath: new ThemeIcon('trash'),
                                  tooltip: DataScience.removeRemoteJupyterServerEntryInQuickPick
                              }
                          ]
                });
            }
        });

        return items;
    }
}

/**
 * Inisders version of the JupyterServerSelector.
 */
class JupyterServerSelector_Insiders implements IJupyterServerSelector {
    private readonly localLabel = `$(zap) ${DataScience.jupyterSelectURINoneLabel}`;
    private readonly newLabel = `$(server) ${DataScience.jupyterSelectURINewLabel}`;
    private readonly remoteLabel = `$(server) ${DataScience.jupyterSelectURIRemoteLabel}`;
    constructor(
        private readonly clipboard: IClipboard,
        private readonly multiStepFactory: IMultiStepInputFactory,
        private extraUriProviders: IJupyterUriProviderRegistration,
        private readonly serverUriStorage: IJupyterServerUriStorage,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly applicationShell: IApplicationShell,
        private readonly configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IsWebExtension) private readonly isWebExtension: boolean
    ) {}

    @capturePerfTelemetry(Telemetry.SelectJupyterURI)
    @traceDecoratorError('Failed to select Jupyter Uri')
    public selectJupyterURI(
        commandSource: SelectJupyterUriCommandSource = 'nonUser'
    ): Promise<InputFlowAction | undefined | InputStep<{}> | void> {
        const allowLocal = commandSource !== 'nonUser';
        sendTelemetryEvent(Telemetry.SetJupyterURIUIDisplayed, undefined, {
            commandSource
        });
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(this.startSelectingURI.bind(this, allowLocal), {});
    }

    @capturePerfTelemetry(Telemetry.SetJupyterURIToLocal)
    public async setJupyterURIToLocal(): Promise<void> {
        await this.serverUriStorage.setUriToLocal();
    }

    public async setJupyterURIToRemote(
        userURI: string,
        ignoreValidation?: boolean,
        displayName?: string
    ): Promise<void> {
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
                const serverId = await computeServerId(userURI);
                await this.errorHandler.handleError(new RemoteJupyterServerConnectionError(userURI, serverId, err));
                // Can't set the URI in this case.
                return;
            }
        }

        const connection = await this.jupyterConnection.createConnectionInfo({ uri: userURI });
        displayName && (connection.displayName = displayName);

        await this.serverUriStorage.setUriToRemote(userURI, connection.displayName);

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
        const remoteUri = await this.serverUriStorage.getRemoteUri();
        // filter out the builtin providers which are only now used in the MRU quick pick.
        const items = (await this.getUriPickList(allowLocal, remoteUri)).filter(
            (item) => !item.provider?.id.startsWith('_builtin')
        );
        const activeItem = items.find((i) => i.url === remoteUri || (i.label === this.localLabel && !remoteUri));
        const currentValue = !remoteUri ? DataScience.jupyterSelectURINoneLabel : activeItem?.label;
        const placeholder = currentValue // This will show at the top (current value really)
            ? DataScience.jupyterSelectURIQuickPickCurrent(currentValue)
            : DataScience.jupyterSelectURIQuickPickPlaceholder;

        let pendingUpdatesToUri = Promise.resolve();
        const onDidChangeItems = new EventEmitter<typeof items>();
        const item = await input.showQuickPick<ISelectUriQuickPickItem, IQuickPickParameters<ISelectUriQuickPickItem>>({
            placeholder,
            items,
            activeItem,
            title: allowLocal
                ? DataScience.jupyterSelectURIQuickPickTitleOld
                : DataScience.jupyterSelectURIQuickPickTitleRemoteOnly,
            onDidTriggerItemButton: (e) => {
                const url = e.item.url;
                if (url && e.button.tooltip === DataScience.removeRemoteJupyterServerEntryInQuickPick) {
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
            await this.setJupyterURIToRemote(item.url || item.label, false, item.label);
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
            title: DataScience.jupyterSelectURIPrompt,
            value: initialValue || defaultUri,
            validate: this.validateSelectJupyterURI,
            prompt: ''
        });

        // Offer the user a change to pick a display name for the server
        // Leaving it blank will use the URI as the display name
        const newDisplayName = await this.applicationShell.showInputBox({
            title: DataScience.jupyterRenameServer
        });

        if (uri) {
            await this.setJupyterURIToRemote(uri, true, newDisplayName || uri);
        }
    }

    public validateSelectJupyterURI = async (inputText: string): Promise<string | undefined> => {
        inputText = inputText.trim();
        try {
            new URL(inputText);
        } catch {
            return DataScience.jupyterSelectURIInvalidURI;
        }

        // Double check http
        if (!inputText.toLowerCase().startsWith('http')) {
            return DataScience.validationErrorMessageForRemoteUrlProtocolNeedsToBeHttpOrHttps;
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
                    return DataScience.jupyterSelfCertFailErrorMessageOnly;
                }
            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleExpiredCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return DataScience.jupyterSelfCertExpiredErrorMessageOnly;
                }
            } else {
                // Return the general connection error to show in the validation box
                // Replace any Urls in the error message with markdown link.
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const errorMessage = (err.message || err.toString()).replace(
                    urlRegex,
                    (url: string) => `[${url}](${url})`
                );
                return (
                    this.isWebExtension || true
                        ? DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                        : DataScience.remoteJupyterConnectionFailedWithoutServerWithError
                )(errorMessage);
            }
        }
    };

    private async getUriPickList(
        allowLocal: boolean,
        currentRemoteUri?: IJupyterServerUriEntry
    ): Promise<ISelectUriQuickPickItem[]> {
        // Ask our providers to stick on items
        let providerItems: ISelectUriQuickPickItem[] = [];
        const providers = await this.extraUriProviders.getProviders();
        if (providers) {
            for (const p of providers) {
                if (p.getQuickPickEntryItems && p.handleQuickPick) {
                    const items = await p.getQuickPickEntryItems();
                    const newProviderItems = items.map((i) => {
                        return { ...i, newChoice: false, provider: p };
                    });
                    providerItems = providerItems.concat(newProviderItems);
                }
            }
        }

        // Always have 'local' and 'add new'
        let items: ISelectUriQuickPickItem[] = [];
        if (allowLocal) {
            items.push({ label: this.localLabel, detail: DataScience.jupyterSelectURINoneDetail, newChoice: false });
            items = items.concat(providerItems);
            items.push({ label: this.newLabel, detail: DataScience.jupyterSelectURINewDetail, newChoice: true });
        } else {
            items = items.concat(providerItems);
            items.push({
                label: this.remoteLabel,
                detail: DataScience.jupyterSelectURIRemoteDetail,
                newChoice: true
            });
        }

        // Get our list of recent server connections and display that as well
        const savedURIList = await this.serverUriStorage.getSavedUriList();
        savedURIList.forEach((uriItem) => {
            if (uriItem.uri && uriItem.isValidated) {
                const uriDate = new Date(uriItem.time);
                const isSelected = currentRemoteUri?.uri === uriItem.uri;
                items.push({
                    label: uriItem.displayName || uriItem.uri,
                    detail: DataScience.jupyterSelectURIMRUDetail(uriDate),
                    // If our display name is not the same as the URI, render the uri as description
                    description: uriItem.displayName !== uriItem.uri ? uriItem.uri : undefined,
                    newChoice: false,
                    url: uriItem.uri,
                    buttons: isSelected
                        ? [] // Cannot delete the current Uri (you can only switch to local).
                        : [
                              {
                                  iconPath: new ThemeIcon('trash'),
                                  tooltip: DataScience.removeRemoteJupyterServerEntryInQuickPick
                              }
                          ]
                });
            }
        });

        return items;
    }
}
