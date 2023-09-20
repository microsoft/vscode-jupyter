// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { inject, injectable, named, optional } from 'inversify';
import uuid from 'uuid/v4';
import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    Disposable,
    Event,
    EventEmitter,
    Memento,
    QuickInputButtons,
    Uri,
    commands,
    env,
    extensions,
    window
} from 'vscode';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import {
    IJupyterServerUriStorage,
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterServerProviderRegistry
} from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import {
    IApplicationShell,
    IClipboard,
    ICommandManager,
    IEncryptedStorage
} from '../../platform/common/application/types';
import {
    Identifiers,
    JUPYTER_HUB_EXTENSION_ID,
    JVSC_EXTENSION_ID,
    Settings,
    Telemetry,
    UserJupyterServerPickerProviderId
} from '../../platform/common/constants';
import {
    GLOBAL_MEMENTO,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    IExtensionContext,
    IMemento,
    IsWebExtension
} from '../../platform/common/types';
import { Common, DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { traceError, traceVerbose, traceWarning } from '../../platform/logging';
import { JupyterPasswordConnect } from './jupyterPasswordConnect';
import {
    IJupyterServerUri,
    JupyterServer,
    JupyterServerCommand,
    JupyterServerCommandProvider,
    JupyterServerProvider
} from '../../api';
import { IMultiStepInputFactory, InputFlowAction } from '../../platform/common/utils/multiStepInput';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../platform/errors/jupyterSelfCertsExpiredError';
import { Deferred, createDeferred } from '../../platform/common/utils/async';
import { IFileSystem } from '../../platform/common/platform/types';
import { RemoteKernelSpecCacheFileName } from '../../kernels/jupyter/constants';
import { dispose } from '../../platform/common/helpers';
import { Disposables } from '../../platform/common/utils';
import { JupyterHubPasswordConnect } from '../userJupyterHubServer/jupyterHubPasswordConnect';
import { sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { generateIdFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';
export const UserJupyterServerUriListKeyV2 = 'user-jupyter-server-uri-list-version2';
export const UserJupyterServerUriListMementoKey = '_builtin.jupyterServerUrlProvider.uriList';
const GlobalStateUserAllowsInsecureConnections = 'DataScienceAllowInsecureConnections';

@injectable()
export class UserJupyterServerUrlProvider
    extends Disposables
    implements IExtensionSyncActivationService, IDisposable, JupyterServerProvider, JupyterServerCommandProvider
{
    readonly id: string = UserJupyterServerPickerProviderId;
    public readonly extensionId: string = JVSC_EXTENSION_ID;
    readonly documentation = Uri.parse('https://aka.ms/vscodeJuptyerExtKernelPickerExistingServer');
    readonly displayName: string = DataScience.UserJupyterServerUrlProviderDisplayName;
    readonly detail: string = DataScience.UserJupyterServerUrlProviderDetail;
    private _onDidChangeHandles = this._register(new EventEmitter<void>());
    onDidChangeHandles: Event<void> = this._onDidChangeHandles.event;
    private _cachedServerInfoInitialized: Promise<void> | undefined;
    private readonly jupyterHubPasswordConnect: JupyterHubPasswordConnect;
    private readonly jupyterPasswordConnect: JupyterPasswordConnect;
    public readonly oldStorage: OldStorage;
    public readonly newStorage: NewStorage;
    private migratedOldServers?: Promise<unknown>;
    private _onDidChangeServers = this._register(new EventEmitter<void>());
    onDidChangeServers = this._onDidChangeServers.event;
    private secureConnectionValidator: SecureConnectionValidator;
    private jupyterServerUriInput: UserJupyterServerUriInput;
    private jupyterServerUriDisplayName: UserJupyterServerDisplayName;
    constructor(
        @inject(IClipboard) clipboard: IClipboard,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMultiStepInputFactory) multiStepFactory: IMultiStepInputFactory,
        @inject(IAsyncDisposableRegistry) asyncDisposableRegistry: IAsyncDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IJupyterRequestAgentCreator)
        @optional()
        agentCreator: IJupyterRequestAgentCreator | undefined,
        @inject(IJupyterRequestCreator) requestCreator: IJupyterRequestCreator,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterServerProviderRegistry: IJupyterServerProviderRegistry
    ) {
        super();
        disposables.push(this);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.oldStorage = new OldStorage(encryptedStorage, globalMemento);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.newStorage = new NewStorage(encryptedStorage);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.secureConnectionValidator = new SecureConnectionValidator(applicationShell, globalMemento);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.jupyterServerUriInput = new UserJupyterServerUriInput(clipboard, applicationShell, requestCreator);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.jupyterServerUriDisplayName = new UserJupyterServerDisplayName(applicationShell);
        this.jupyterPasswordConnect = new JupyterPasswordConnect(
            applicationShell,
            configService,
            agentCreator,
            requestCreator,
            serverUriStorage,
            disposables
        );
        this.jupyterHubPasswordConnect = new JupyterHubPasswordConnect(
            applicationShell,
            multiStepFactory,
            asyncDisposableRegistry,
            configService,
            agentCreator,
            requestCreator,
            serverUriStorage,
            disposables
        );
    }
    activate() {
        // Register this ASAP.
        const collection = this.jupyterServerProviderRegistry.createJupyterServerCollection(
            JVSC_EXTENSION_ID,
            this.id,
            this.displayName,
            this
        );
        this.disposables.push(collection);
        collection.commandProvider = this;
        collection.documentation = this.documentation;
        this.onDidChangeHandles(() => this._onDidChangeServers.fire(), this, this.disposables);
        this.disposables.push(
            this.commandManager.registerCommand('dataScience.ClearUserProviderJupyterServerCache', async () => {
                await Promise.all([
                    this.oldStorage.clear().catch(noop),
                    this.newStorage.clear().catch(noop),
                    this.fs
                        .delete(Uri.joinPath(this.context.globalStorageUri, RemoteKernelSpecCacheFileName))
                        .catch(noop)
                ]);
                this._onDidChangeHandles.fire();
            })
        );
        this.initializeServers().catch(noop);
    }
    public async resolveJupyterServer(server: JupyterServer, _token: CancellationToken) {
        const serverInfo = await this.getServerUri(server.id);
        return {
            ...server,
            connectionInformation: {
                id: server.id,
                label: server.label,
                baseUrl: Uri.parse(serverInfo.baseUrl),
                token: serverInfo.token,
                headers: serverInfo.authorizationHeader,
                mappedRemoteNotebookDir: serverInfo.mappedRemoteNotebookDir
                    ? Uri.file(serverInfo.mappedRemoteNotebookDir)
                    : undefined,
                webSocketProtocols: serverInfo.webSocketProtocols
            }
        };
    }
    public async handleCommand(
        command: JupyterServerCommand & { url?: string },
        _token: CancellationToken
    ): Promise<JupyterServer | undefined> {
        const token = new CancellationTokenSource();
        this.disposables.push(token);
        this.disposables.push(new Disposable(() => token.cancel()));
        try {
            const url = 'url' in command ? command.url : undefined;
            const handleOrBack = await this.captureRemoteJupyterUrl(token.token, url);
            if (!handleOrBack || handleOrBack === InputFlowAction.cancel) {
                throw new CancellationError();
            }
            if (handleOrBack && handleOrBack instanceof InputFlowAction) {
                return undefined;
            }
            const servers = await this.provideJupyterServers(token.token);
            const server = servers.find((s) => s.id === handleOrBack);
            if (!server) {
                throw new Error(`Server ${handleOrBack} not found`);
            }
            return server;
        } catch (ex) {
            if (ex instanceof CancellationError) {
                throw ex;
            }
            traceError(`Failed to select a Jupyter Server`, ex);
            return;
        } finally {
            token.cancel();
            token.dispose();
        }
    }
    /**
     * @param value Value entered by the user in the quick pick
     */
    async provideCommands(value: string, _token: CancellationToken): Promise<JupyterServerCommand[]> {
        let url = '';
        try {
            value = (value || '').trim();
            if (['http:', 'https:'].includes(new URL(value.trim()).protocol.toLowerCase())) {
                url = value;
            }
        } catch {
            //
        }
        if (url) {
            const label = DataScience.connectToToTheJupyterServer(url);
            return [{ label, url } as JupyterServerCommand];
        }
        return [{ label: DataScience.jupyterSelectUriCommandLabel, picked: true }];
    }
    async provideJupyterServers(_token: CancellationToken): Promise<JupyterServer[]> {
        await this.initializeServers();
        const servers = await this.newStorage.getServers(false);
        return servers.map((s) => {
            return {
                id: s.handle,
                label: s.serverInfo.displayName
            };
        });
    }
    public async removeJupyterServer(server: JupyterServer): Promise<void> {
        await this.initializeServers();
        await this.newStorage.remove(server.id);
        this._onDidChangeHandles.fire();
    }
    private migrateOldServers() {
        if (!this.migratedOldServers) {
            this.migratedOldServers = this.oldStorage
                .getServers()
                .then(async (servers) => {
                    await this.newStorage.migrate(servers, this.serverUriStorage);
                    // List is in the global memento, URIs are in encrypted storage
                    const indexes = this.globalMemento.get<{ index: number; time: number }[]>(
                        Settings.JupyterServerUriList
                    );
                    if (!Array.isArray(indexes) || indexes.length === 0) {
                        return;
                    }

                    // Pull out the \r separated URI list (\r is an invalid URI character)
                    const blob = await this.encryptedStorage.retrieve(
                        Settings.JupyterServerRemoteLaunchService,
                        Settings.JupyterServerRemoteLaunchUriListKey
                    );
                    if (!blob) {
                        return;
                    }
                    // Make sure same length
                    const migratedServers: {
                        time: number;
                        handle: string;
                        uri: string;
                        serverInfo: IJupyterServerUri;
                    }[] = [];

                    const split = blob.split(Settings.JupyterServerRemoteLaunchUriSeparator);
                    split.slice(0, Math.min(split.length, indexes.length)).forEach((item, index) => {
                        try {
                            const uriAndDisplayName = item.split(Settings.JupyterServerRemoteLaunchNameSeparator);
                            const uri = uriAndDisplayName[0];
                            // Old code (we may have stored a bogus url in the past).
                            if (uri === Settings.JupyterServerLocalLaunch) {
                                return;
                            }
                            if (uri.startsWith(Identifiers.REMOTE_URI)) {
                                return;
                            }
                            const serverInfo = parseUri(uri, uriAndDisplayName[1] || uri);
                            if (serverInfo && servers.every((s) => s.uri !== uri)) {
                                // We have a saved Url.
                                const handle = uuid();
                                migratedServers.push({
                                    time: indexes[index].time,
                                    handle,
                                    uri,
                                    serverInfo
                                });
                            }
                        } catch {
                            // Ignore errors.
                        }
                    });

                    if (migratedServers.length > 0) {
                        // Ensure we update the storage with the new items and new format.
                        await Promise.all(
                            migratedServers.map(async (server) => {
                                try {
                                    await this.addNewServer(server);
                                    await this.serverUriStorage.add(
                                        { id: this.id, handle: server.handle, extensionId: JVSC_EXTENSION_ID },
                                        { time: server.time }
                                    );
                                } catch {
                                    //
                                }
                            })
                        );
                    }
                })
                .catch(noop);
        }
        return this.migratedOldServers;
    }
    private initializeServers(): Promise<void> {
        if (this._cachedServerInfoInitialized) {
            return this._cachedServerInfoInitialized;
        }
        const deferred = createDeferred<void>();
        this._cachedServerInfoInitialized = deferred.promise;

        (async () => {
            const NEW_STORAGE_MIGRATION_DONE_KEY = 'NewUserUriMigrationCompleted';
            if (this.globalMemento.get<string>(NEW_STORAGE_MIGRATION_DONE_KEY) !== env.machineId) {
                await Promise.all([this.migrateOldServers().catch(noop), this.newStorage.migrationDone]);
                await this.globalMemento.update(NEW_STORAGE_MIGRATION_DONE_KEY, env.machineId);
            }
            this.newStorage.getServers(false).catch(noop);
            deferred.resolve();
        })()
            .then(
                () => deferred.resolve(),
                (ex) => deferred.reject(ex)
            )
            .catch(noop);
        return this._cachedServerInfoInitialized;
    }
    private recommendInstallingJupyterHubExtension() {
        if (extensions.getExtension(JUPYTER_HUB_EXTENSION_ID)) {
            this.applicationShell
                .showInformationMessage(DataScience.useJupyterHubExtension, {
                    modal: true,
                    detail: DataScience.useJupyterHubExtensionDetail
                })
                .then(() => {
                    // Re-display the kernel picker forcing the user to pick the right option.
                    commands
                        .executeCommand('notebook.selectKernel', { notebookEditor: window.activeNotebookEditor })
                        .then(noop, noop);
                }, noop);
        } else {
            this.applicationShell
                .showInformationMessage(
                    DataScience.installJupyterHub,
                    { modal: true, detail: DataScience.installJupyterHubDetail },
                    Common.install,
                    Common.moreInfo
                )
                .then((selection) => {
                    if (selection === Common.install) {
                        commands
                            .executeCommand('workbench.extensions.installExtension', JUPYTER_HUB_EXTENSION_ID, {
                                context: { skipWalkthrough: true }
                            })
                            .then(noop, noop);
                    } else if (selection === Common.moreInfo) {
                        env.openExternal(
                            Uri.parse('https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter-hub')
                        ).then(noop, noop);
                    }
                }, noop);
        }
    }
    async captureRemoteJupyterUrl(
        token: CancellationToken,
        initialUrl: string = ''
    ): Promise<string | InputFlowAction> {
        await this.initializeServers();
        type Steps =
            | 'Get Url'
            | 'Check Passwords'
            | 'Check Insecure Connections'
            | 'Verify Connection'
            | 'Get Display Name';

        const disposables: Disposable[] = [];
        let jupyterServerUri: IJupyterServerUri = { baseUrl: '', displayName: '', token: '' };
        let validationErrorMessage = '';
        let requiresPassword = false;
        let isInsecureConnection = false;
        let handle: string;
        let nextStep: Steps = 'Get Url';
        let previousStep: Steps | undefined = 'Get Url';
        let url = initialUrl;
        let initialUrlWasValid = false;
        if (initialUrl) {
            // Validate the URI first, which would otherwise be validated when user enters the Uri into the input box.
            const initialVerification = await this.jupyterServerUriInput.parseUserUriAndGetValidationError(initialUrl);
            if (typeof initialVerification.validationError === 'string') {
                // Uri has an error, show the error message by displaying the input box and pre-populating the url.
                validationErrorMessage = initialVerification.validationError;
                nextStep = 'Get Url';
            } else {
                initialUrlWasValid = true;
                jupyterServerUri = initialVerification.jupyterServerUri;
                nextStep = 'Check Passwords';
            }
        }
        try {
            let isJupyterHub: boolean = false;
            while (true) {
                try {
                    handle = uuid();
                    if (nextStep === 'Get Url') {
                        initialUrlWasValid = false;
                        nextStep = 'Check Passwords';
                        previousStep = undefined;
                        const errorMessage = validationErrorMessage;
                        validationErrorMessage = ''; // Never display this validation message again.
                        const result = await this.jupyterServerUriInput.getUrlFromUser(
                            url || initialUrl,
                            errorMessage,
                            disposables
                        );
                        jupyterServerUri = result.jupyterServerUri;
                        url = result.url;
                    }
                    if (token.isCancellationRequested) {
                        return InputFlowAction.cancel;
                    }

                    // Capture the password disposable objects into a separate array.
                    // We want to keep this Quick Pick UI open, as the validation happens outside that class.
                    // The UI gets closed when we dispose the disposables.
                    // After the validation, we dispose the UI, and optionally display a new UI.
                    // This way there is no flicker in the UI.
                    const passwordDisposables: Disposable[] = [];
                    if (nextStep === 'Check Passwords') {
                        nextStep = 'Check Insecure Connections';
                        // If we were given a Url, then back should get out of this flow.
                        previousStep = initialUrlWasValid && initialUrl ? undefined : 'Get Url';

                        try {
                            const errorMessage = validationErrorMessage;
                            validationErrorMessage = ''; // Never display this validation message again.
                            isJupyterHub = await this.jupyterHubPasswordConnect.isJupyterHub(jupyterServerUri.baseUrl);
                            if (isJupyterHub) {
                                this.recommendInstallingJupyterHubExtension();
                                throw new CancellationError();
                            }
                            const result = isJupyterHub
                                ? await this.jupyterHubPasswordConnect.getPasswordConnectionInfo({
                                      url: jupyterServerUri.baseUrl,
                                      handle,
                                      displayName: jupyterServerUri.displayName,
                                      validationErrorMessage: errorMessage,
                                      disposables: passwordDisposables
                                  })
                                : await this.jupyterPasswordConnect.getPasswordConnectionInfo({
                                      url: jupyterServerUri.baseUrl,
                                      isTokenEmpty: jupyterServerUri.token.length === 0,
                                      handle,
                                      validationErrorMessage: errorMessage,
                                      disposables: passwordDisposables
                                  });
                            requiresPassword = result.requiresPassword;
                            jupyterServerUri.authorizationHeader = result.requestHeaders;
                        } catch (err) {
                            if (
                                err instanceof CancellationError ||
                                err == InputFlowAction.back ||
                                err == InputFlowAction.cancel
                            ) {
                                throw err;
                            } else if (JupyterSelfCertsError.isSelfCertsError(err)) {
                                // We can skip this for now, as this will get verified again
                                // First we need to check with user whether to allow insecure connections and untrusted certs.
                            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                                // We can skip this for now, as this will get verified again
                                // First we need to check with user whether to allow insecure connections and untrusted certs.
                            } else {
                                sendRemoteTelemetryForAdditionOfNewRemoteServer(
                                    handle,
                                    jupyterServerUri.baseUrl,
                                    isJupyterHub,
                                    'ConnectionFailure'
                                );
                                // Return the general connection error to show in the validation box
                                // Replace any Urls in the error message with markdown link.
                                const urlRegex = /(https?:\/\/[^\s]+)/g;
                                const errorMessage = (err.message || err.toString()).replace(
                                    urlRegex,
                                    (url: string) => `[${url}](${url})`
                                );
                                validationErrorMessage = (
                                    this.isWebExtension
                                        ? DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                                        : DataScience.remoteJupyterConnectionFailedWithoutServerWithError
                                )(errorMessage);
                                nextStep = 'Get Url';
                                continue;
                            }
                        } finally {
                            this.disposables.push(...passwordDisposables);
                        }
                    }
                    if (token.isCancellationRequested) {
                        return InputFlowAction.cancel;
                    }

                    if (nextStep === 'Check Insecure Connections') {
                        // If we do not have any auth header information & there is no token & no password,
                        // & this is HTTP then this is an insecure server
                        // & we need to ask the user for consent to use this insecure server.
                        nextStep = 'Verify Connection';
                        previousStep =
                            requiresPassword && jupyterServerUri.token.length === 0 ? 'Check Passwords' : 'Get Url';
                        if (previousStep === 'Get Url') {
                            // If we were given a Url, then back should get out of this flow.
                            previousStep = initialUrlWasValid && initialUrl ? undefined : 'Get Url';
                        }
                        if (
                            !requiresPassword &&
                            jupyterServerUri.token.length === 0 &&
                            new URL(jupyterServerUri.baseUrl).protocol.toLowerCase() === 'http:'
                        ) {
                            isInsecureConnection = true;
                            dispose(passwordDisposables);
                            const proceed = await this.secureConnectionValidator.promptToUseInsecureConnections();
                            if (!proceed) {
                                sendRemoteTelemetryForAdditionOfNewRemoteServer(
                                    handle,
                                    jupyterServerUri.baseUrl,
                                    isJupyterHub,
                                    'InsecureHTTP'
                                );
                                return InputFlowAction.cancel;
                            }
                        }
                    }
                    if (token.isCancellationRequested) {
                        return InputFlowAction.cancel;
                    }

                    if (nextStep === 'Verify Connection') {
                        try {
                            nextStep = 'Get Display Name';
                            await this.jupyterConnection.validateRemoteUri(
                                { id: this.id, handle, extensionId: JVSC_EXTENSION_ID },
                                jupyterServerUri,
                                true
                            );
                        } catch (err) {
                            traceWarning('Uri verification error', err);
                            if (
                                err instanceof CancellationError ||
                                err == InputFlowAction.back ||
                                err == InputFlowAction.cancel
                            ) {
                                throw err;
                            } else if (JupyterSelfCertsError.isSelfCertsError(err)) {
                                validationErrorMessage = DataScience.jupyterSelfCertFailErrorMessageOnly;
                                nextStep = 'Get Url';
                                sendRemoteTelemetryForAdditionOfNewRemoteServer(
                                    handle,
                                    jupyterServerUri.baseUrl,
                                    isJupyterHub,
                                    'SelfCert'
                                );
                                continue;
                            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                                validationErrorMessage = DataScience.jupyterSelfCertExpiredErrorMessageOnly;
                                nextStep = 'Get Url';
                                sendRemoteTelemetryForAdditionOfNewRemoteServer(
                                    handle,
                                    jupyterServerUri.baseUrl,
                                    isJupyterHub,
                                    'ExpiredCert'
                                );
                                continue;
                            } else if (requiresPassword && jupyterServerUri.token.length === 0) {
                                validationErrorMessage = DataScience.passwordFailure;
                                nextStep = 'Check Passwords';
                                sendRemoteTelemetryForAdditionOfNewRemoteServer(
                                    handle,
                                    jupyterServerUri.baseUrl,
                                    isJupyterHub,
                                    'AuthFailure'
                                );
                                continue;
                            } else {
                                sendRemoteTelemetryForAdditionOfNewRemoteServer(
                                    handle,
                                    jupyterServerUri.baseUrl,
                                    isJupyterHub,
                                    'ConnectionFailure'
                                );
                                // Return the general connection error to show in the validation box
                                // Replace any Urls in the error message with markdown link.
                                const urlRegex = /(https?:\/\/[^\s]+)/g;
                                const errorMessage = (err.message || err.toString()).replace(
                                    urlRegex,
                                    (url: string) => `[${url}](${url})`
                                );
                                validationErrorMessage = (
                                    this.isWebExtension || true
                                        ? DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                                        : DataScience.remoteJupyterConnectionFailedWithoutServerWithError
                                )(errorMessage);
                                nextStep = 'Get Url';
                                continue;
                            }
                        } finally {
                            dispose(passwordDisposables);
                        }
                    }
                    if (token.isCancellationRequested) {
                        return InputFlowAction.cancel;
                    }

                    if (nextStep === 'Get Display Name') {
                        dispose(passwordDisposables);
                        previousStep = isInsecureConnection
                            ? 'Check Insecure Connections'
                            : requiresPassword && jupyterServerUri.token.length === 0
                            ? 'Check Passwords'
                            : 'Get Url';
                        if (previousStep === 'Get Url') {
                            // If we were given a Url, then back should get out of this flow.
                            previousStep = initialUrlWasValid && initialUrl ? undefined : 'Get Url';
                        }

                        jupyterServerUri.displayName = await this.jupyterServerUriDisplayName.getDisplayName(
                            handle,
                            jupyterServerUri.displayName || new URL(jupyterServerUri.baseUrl).hostname
                        );
                        break;
                    }
                } catch (ex) {
                    if (ex instanceof CancellationError || ex === InputFlowAction.cancel) {
                        // This means exit all of this, & do not event go back
                        return InputFlowAction.cancel;
                    }
                    if (ex === InputFlowAction.back) {
                        if (!previousStep) {
                            // Go back to the beginning of this workflow, ie. back to calling code.
                            return InputFlowAction.back;
                        }
                        nextStep = previousStep;
                        continue;
                    }

                    throw ex;
                }
            }
            if (token.isCancellationRequested) {
                return InputFlowAction.cancel;
            }
            await this.addNewServer({
                handle,
                uri: url,
                serverInfo: jupyterServerUri
            });
            sendRemoteTelemetryForAdditionOfNewRemoteServer(handle, jupyterServerUri.baseUrl, isJupyterHub);
            return handle;
        } catch (ex) {
            if (ex instanceof CancellationError) {
                return InputFlowAction.cancel;
            }
            throw ex;
        } finally {
            dispose(disposables);
        }
    }
    private async addNewServer(server: { handle: string; uri: string; serverInfo: IJupyterServerUri }) {
        await this.newStorage.add(server);
        this._onDidChangeHandles.fire();
    }
    async getServerUri(id: string): Promise<IJupyterServerUri> {
        const servers = await this.newStorage.getServers(false);
        const server = servers.find((s) => s.handle === id);
        if (!server) {
            throw new Error('Server not found');
        }
        const serverInfo = server.serverInfo;
        // Hacky due to the way display names are stored in uri storage.
        // Should be cleaned up later.
        const displayName = this.jupyterServerUriDisplayName.displayNamesOfHandles.get(id);
        if (displayName) {
            serverInfo.displayName = displayName;
        }

        const isJupyterHub = await this.jupyterHubPasswordConnect.isJupyterHub(serverInfo.baseUrl);
        const passwordResult = isJupyterHub
            ? await this.jupyterHubPasswordConnect.getPasswordConnectionInfo({
                  url: serverInfo.baseUrl,
                  handle: id,
                  displayName: serverInfo.displayName
              })
            : await this.jupyterPasswordConnect.getPasswordConnectionInfo({
                  url: serverInfo.baseUrl,
                  isTokenEmpty: serverInfo.token.length === 0,
                  handle: id
              });

        const serverUriToReturn = Object.assign({}, serverInfo, {
            authorizationHeader: passwordResult.requestHeaders || serverInfo.authorizationHeader
        });

        if (isJupyterHub && passwordResult.remappedBaseUrl) {
            serverUriToReturn.baseUrl = passwordResult.remappedBaseUrl;
        }
        if (isJupyterHub && passwordResult.remappedToken) {
            serverUriToReturn.token = passwordResult.remappedToken;
        }
        return serverUriToReturn;
    }
}

export class UserJupyterServerUriInput {
    constructor(
        @inject(IClipboard) private readonly clipboard: IClipboard,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IJupyterRequestCreator) private readonly requestCreator: IJupyterRequestCreator
    ) {}

    async getUrlFromUser(
        initialValue: string,
        initialErrorMessage: string = '',
        disposables: Disposable[]
    ): Promise<{ url: string; jupyterServerUri: IJupyterServerUri }> {
        if (!initialValue) {
            try {
                const text = await this.clipboard.readText().catch(() => '');
                const parsedUri = Uri.parse(text.trim(), true);
                // Only display http/https uris.
                initialValue = text && parsedUri && parsedUri.scheme.toLowerCase().startsWith('http') ? text : '';
            } catch {
                // We can ignore errors.
            }
        }

        // Ask the user to enter a URI to connect to.
        const input = this.applicationShell.createInputBox();
        disposables.push(input);
        input.title = DataScience.jupyterSelectUriInputTitle;
        input.placeholder = DataScience.jupyterSelectUriInputPlaceholder;
        input.value = initialValue;
        input.validationMessage = initialErrorMessage;
        input.buttons = [QuickInputButtons.Back];
        input.ignoreFocusOut = true;
        input.show();

        const deferred = createDeferred<{ url: string; jupyterServerUri: IJupyterServerUri }>();
        input.onDidChangeValue(() => (input.validationMessage = ''), this, disposables);
        input.onDidHide(() => deferred.reject(InputFlowAction.cancel), this, disposables);
        input.onDidTriggerButton(
            (item) => {
                if (item === QuickInputButtons.Back) {
                    deferred.reject(InputFlowAction.back);
                }
            },
            this,
            disposables
        );

        input.onDidAccept(async () => {
            const result = await this.parseUserUriAndGetValidationError(input.value);
            if (typeof result.validationError === 'string') {
                input.validationMessage = result.validationError;
                return;
            }
            deferred.resolve(result);
        });
        return deferred.promise;
    }

    public async parseUserUriAndGetValidationError(
        value: string
    ): Promise<
        { validationError: string } | { jupyterServerUri: IJupyterServerUri; url: string; validationError: undefined }
    > {
        // If it ends with /lab? or /lab or /tree? or /tree, then remove that part.
        const uri = value.trim().replace(/\/(lab|tree)(\??)$/, '');
        const jupyterServerUri = parseUri(uri, '');
        if (!jupyterServerUri) {
            return { validationError: DataScience.jupyterSelectURIInvalidURI };
        }
        jupyterServerUri.baseUrl = (await getBaseJupyterUrl(uri, this.requestCreator)) || jupyterServerUri.baseUrl;
        if (!uri.toLowerCase().startsWith('http:') && !uri.toLowerCase().startsWith('https:')) {
            return { validationError: DataScience.jupyterSelectURIMustBeHttpOrHttps };
        }
        return { jupyterServerUri, url: uri, validationError: undefined };
    }
}

export async function getBaseJupyterUrl(url: string, requestCreator: IJupyterRequestCreator) {
    // Jupyter URLs can contain a path, but we only want the base URL
    // E.g. user can enter http://localhost:8000/tree?token=1234
    // and we need http://localhost:8000/
    // Similarly user can enter http://localhost:8888/lab/workspaces/auto-R
    // or http://localhost:8888/notebooks/Untitled.ipynb?kernel_name=python3
    // In all of these cases, once we remove the token, and we make a request to the url
    // then the jupyter server will redirect the user the loging page
    // which is of the form http://localhost:8000/login?next....
    // And the base url is easily identifiable as what ever is before `login?`
    try {
        // parseUri has special handling of `tree?` and `lab?`
        // For some reasson Jupyter does not redirecto those the the a
        url = parseUri(url, '')?.baseUrl || url;
        if (new URL(url).pathname === '/') {
            // No need to make a request, as we already have the base url.
            return url;
        }
        const urlWithoutToken = url.indexOf('token=') > 0 ? url.substring(0, url.indexOf('token=')) : url;
        const fetch = requestCreator.getFetchMethod();
        const response = await fetch(urlWithoutToken, { method: 'GET', redirect: 'manual' });
        const loginPage = response.headers.get('location');
        if (loginPage && loginPage.includes('login?')) {
            return loginPage.substring(0, loginPage.indexOf('login?'));
        }
    } catch (ex) {
        traceVerbose(`Unable to identify the baseUrl of the Jupyter Server`, ex);
    }
}

function sendRemoteTelemetryForAdditionOfNewRemoteServer(
    handle: string,
    baseUrl: string,
    isJupyterHub: boolean,
    failureReason?: 'ConnectionFailure' | 'InsecureHTTP' | 'SelfCert' | 'ExpiredCert' | 'AuthFailure'
) {
    baseUrl = baseUrl.trim().toLowerCase();
    const id = generateIdFromRemoteProvider({
        handle,
        extensionId: JVSC_EXTENSION_ID,
        id: UserJupyterServerPickerProviderId
    });
    Promise.all([getTelemetrySafeHashedString(baseUrl.toLowerCase()), getTelemetrySafeHashedString(id.toLowerCase())])
        .then(([baseUrlHash, serverIdHash]) => {
            sendTelemetryEvent(Telemetry.EnterRemoteJupyterUrl, undefined, {
                serverIdHash,
                failed: !!failureReason,
                baseUrlHash,
                isJupyterHub,
                isLocalHost: ['localhost', '127.0.0.1', '::1'].includes(new URL(baseUrl).hostname),
                reason: failureReason
            });
        })
        .catch((ex) => traceError(`Failed to hash remote url ${baseUrl}`, ex));
}

export class UserJupyterServerDisplayName {
    constructor(@inject(IApplicationShell) private readonly applicationShell: IApplicationShell) {}
    public displayNamesOfHandles = new Map<string, string>();
    public async getDisplayName(handle: string, defaultValue: string): Promise<string> {
        const disposables: Disposable[] = [];
        try {
            const input = this.applicationShell.createInputBox();
            disposables.push(input);
            input.ignoreFocusOut = true;
            input.title = DataScience.jupyterRenameServer;
            input.value = defaultValue;
            input.placeholder = DataScience.jupyterServerUriDisplayNameInputPlaceholder;
            input.buttons = [QuickInputButtons.Back];
            input.show();
            const deferred = createDeferred<string>();
            disposables.push(input.onDidHide(() => deferred.reject(InputFlowAction.cancel)));
            input.onDidTriggerButton(
                (e) => {
                    if (e === QuickInputButtons.Back) {
                        deferred.reject(InputFlowAction.back);
                    }
                },
                this,
                disposables
            );
            input.onDidAccept(
                () => {
                    const displayName = input.value.trim() || defaultValue;
                    this.displayNamesOfHandles.set(handle, displayName);
                    deferred.resolve(displayName);
                },
                this,
                disposables
            );
            return await deferred.promise;
        } finally {
            dispose(disposables);
        }
    }
}
export class SecureConnectionValidator {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {}

    public async promptToUseInsecureConnections(): Promise<boolean> {
        if (this.globalMemento.get(GlobalStateUserAllowsInsecureConnections, false)) {
            return true;
        }

        const disposables: Disposable[] = [];
        const deferred = createDeferred<boolean>();
        try {
            const input = this.applicationShell.createQuickPick();
            disposables.push(input);
            input.canSelectMany = false;
            input.ignoreFocusOut = true;
            input.title = DataScience.insecureSessionMessage;
            input.buttons = [QuickInputButtons.Back];
            input.items = [{ label: Common.bannerLabelYes }, { label: Common.bannerLabelNo }];
            input.show();
            disposables.push(input.onDidHide(() => deferred.reject(InputFlowAction.cancel)));
            input.onDidTriggerButton(
                (e) => {
                    if (e === QuickInputButtons.Back) {
                        deferred.reject(InputFlowAction.back);
                    }
                },
                this,
                disposables
            );
            input.onDidAccept(
                () => deferred.resolve(input.selectedItems.some((e) => e.label === Common.bannerLabelYes)),
                this,
                disposables
            );
        } finally {
            dispose(disposables);
        }
        return deferred.promise;
    }
}
export function parseUri(uri: string, displayName?: string): IJupyterServerUri | undefined {
    // This is a url that we crafted. It's not a valid Jupyter Server Url.
    if (uri.startsWith(Identifiers.REMOTE_URI)) {
        return;
    }
    try {
        const url = new URL(uri);

        // Special case for URI's ending with 'lab'. Remove this from the URI. This is not
        // the location for connecting to jupyterlab
        const baseUrl = `${url.protocol}//${url.host}${
            url.pathname === '/lab' || url.pathname === '/tree' ? '' : url.pathname
        }`;

        return {
            baseUrl: baseUrl,
            token: url.searchParams.get('token') || '',
            displayName: displayName || url.hostname
        };
    } catch (err) {
        traceError(`Failed to parse URI ${uri}`, err);
        // This should already have been parsed when set, so just throw if it's not right here
        return undefined;
    }
}

export class OldStorage {
    constructor(
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {}

    public async getServers(): Promise<{ handle: string; uri: string; serverInfo: IJupyterServerUri }[]> {
        const serverList = this.globalMemento.get<{ index: number; handle: string }[]>(
            UserJupyterServerUriListMementoKey
        );

        const cache = await this.encryptedStorage.retrieve(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKey
        );

        if (!cache || !serverList || serverList.length === 0) {
            return [];
        }

        const encryptedList = cache.split(Settings.JupyterServerRemoteLaunchUriSeparator);
        if (encryptedList.length === 0 || encryptedList.length !== serverList.length) {
            traceError('Invalid server list, unable to retrieve server info');
            return [];
        }

        const servers: { handle: string; uri: string; serverInfo: IJupyterServerUri }[] = [];

        for (let i = 0; i < encryptedList.length; i += 1) {
            if (encryptedList[i].startsWith(Identifiers.REMOTE_URI)) {
                continue;
            }
            const serverInfo = parseUri(encryptedList[i]);
            if (!serverInfo) {
                traceError('Unable to parse server info', encryptedList[i]);
            } else {
                servers.push({
                    handle: serverList[i].handle,
                    uri: encryptedList[i],
                    serverInfo
                });
            }
        }
        return servers;
    }
    public async clear() {
        await this.encryptedStorage
            .store(Settings.JupyterServerRemoteLaunchService, UserJupyterServerUriListKey, '')
            .catch(noop);
        await this.globalMemento.update(UserJupyterServerUriListMementoKey, []).then(noop, noop);
    }
}

type StorageItem = {
    handle: string;
    uri: string;
    displayName: string;
};
function serverToStorageFormat(
    servers: {
        handle: string;
        uri: string;
        serverInfo: IJupyterServerUri;
    }[]
): StorageItem[] {
    return servers.map((s) => ({ handle: s.handle, uri: s.uri, displayName: s.serverInfo.displayName }));
}
function storageFormatToServers(items: StorageItem[]) {
    const servers: {
        handle: string;
        uri: string;
        serverInfo: IJupyterServerUri;
    }[] = [];
    items.forEach((s) => {
        const server = parseUri(s.uri, s.displayName);
        if (!server) {
            return;
        }
        servers.push({
            handle: s.handle,
            uri: s.uri,
            serverInfo: server
        });
    });
    return servers;
}

export class NewStorage {
    private readonly _migrationDone: Deferred<void>;
    private updatePromise = Promise.resolve();
    private servers?: { handle: string; uri: string; serverInfo: IJupyterServerUri }[];
    public get migrationDone(): Promise<void> {
        return this._migrationDone.promise;
    }
    constructor(@inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage) {
        this._migrationDone = createDeferred<void>();
    }

    public async migrate(
        servers: {
            handle: string;
            uri: string;
            serverInfo: IJupyterServerUri;
        }[],
        uriStorage: IJupyterServerUriStorage
    ) {
        const data = await this.encryptedStorage.retrieve(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2
        );

        if (typeof data === 'string') {
            // Already migrated once before, next migrate the display names
            let userServers: { handle: string; uri: string; serverInfo: IJupyterServerUri }[] = [];
            let displayNamesMigrated = false;
            try {
                const storageData: StorageItem[] = JSON.parse(data || '[]');
                displayNamesMigrated = storageData.some((s) => s.displayName);
                userServers = storageFormatToServers(storageData);
            } catch {
                return;
            }

            if (!displayNamesMigrated) {
                await this.migrateDisplayNames(userServers, uriStorage);
            }
            return this._migrationDone.resolve();
        }
        this.encryptedStorage
            .store(
                Settings.JupyterServerRemoteLaunchService,
                'user-jupyter-server-uri-list-v2', // Removed as this storage data is not in the best format.
                undefined
            )
            .catch(noop);
        await this.migrateDisplayNames(servers, uriStorage);
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2,
            JSON.stringify(servers)
        );
        this._migrationDone.resolve();
    }
    public async migrateDisplayNames(
        userServers: { handle: string; uri: string; serverInfo: IJupyterServerUri }[],
        uriStorage: IJupyterServerUriStorage
    ) {
        if (userServers.length === 0) {
            // No migration necessary
            return;
        }
        const allServers = await uriStorage.getAll().catch((ex) => {
            traceError('Failed to get all servers from storage', ex);
            return [];
        });
        const userServersFromUriStorage = new Map(
            allServers
                .filter(
                    (s) =>
                        s.provider.extensionId === JVSC_EXTENSION_ID &&
                        s.provider.id === UserJupyterServerPickerProviderId
                )
                .map((s) => [s.provider.handle, s.displayName])
        );
        // Get the display name from the UriStorage and save that in here.
        userServers.forEach((server) => {
            server.serverInfo.displayName = userServersFromUriStorage.get(server.handle) || server.uri;
        });
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2,
            JSON.stringify(serverToStorageFormat(userServers))
        );
    }
    public async getServers(
        ignoreCache: boolean
    ): Promise<{ handle: string; uri: string; serverInfo: IJupyterServerUri }[]> {
        if (this.servers && !ignoreCache) {
            return this.servers;
        }
        const data = await this.encryptedStorage.retrieve(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2
        );
        if (!data || data === '[]') {
            return [];
        }
        try {
            return (this.servers = storageFormatToServers(JSON.parse(data)));
        } catch {
            return [];
        }
    }

    public async add(server: { handle: string; uri: string; serverInfo: IJupyterServerUri }) {
        if (this.servers) {
            this.servers = this.servers.filter((s) => s.handle !== server.handle).concat(server);
        }
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                const servers = (await this.getServers(true)).concat(server);
                this.servers = servers;
                await this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKeyV2,
                    JSON.stringify(serverToStorageFormat(servers))
                );
            })
            .catch(noop));
    }
    public async remove(handle: string) {
        if (this.servers) {
            this.servers = this.servers.filter((s) => s.handle !== handle);
        }
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                const servers = (await this.getServers(true)).filter((s) => s.handle !== handle);
                this.servers = servers;
                return this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKeyV2,
                    JSON.stringify(serverToStorageFormat(servers))
                );
            })
            .catch(noop));
    }
    public async clear() {
        this.servers = [];
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                this.servers = [];
                await this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKeyV2,
                    undefined
                );
            })
            .catch(noop));
    }
}
