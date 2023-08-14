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
    env
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
    JVSC_EXTENSION_ID,
    Settings,
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
import { traceError, traceWarning } from '../../platform/logging';
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
import { disposeAllDisposables } from '../../platform/common/helpers';
import { Disposables } from '../../platform/common/utils';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';
export const UserJupyterServerUriListKeyV2 = 'user-jupyter-server-uri-list-version2';
export const UserJupyterServerUriListMementoKey = '_builtin.jupyterServerUrlProvider.uriList';
const GlobalStateUserAllowsInsecureConnections = 'DataScienceAllowInsecureConnections';
export const EnterJupyterServerUriCommand = 'jupyter.selectLocalJupyterServer';

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
    private _localDisposables: Disposable[] = [];
    private readonly passwordConnect: JupyterPasswordConnect;
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
        @inject(IApplicationShell) applicationShell: IApplicationShell,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMultiStepInputFactory) multiStepFactory: IMultiStepInputFactory,
        @inject(IAsyncDisposableRegistry) asyncDisposableRegistry: IAsyncDisposableRegistry,
        @inject(ICommandManager) private readonly commands: ICommandManager,
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
        this.jupyterServerUriInput = new UserJupyterServerUriInput(clipboard, applicationShell);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.jupyterServerUriDisplayName = new UserJupyterServerDisplayName(applicationShell);
        this.passwordConnect = new JupyterPasswordConnect(
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
    selected: JupyterServerCommand = {
        title: DataScience.jupyterSelectURIPrompt,
        tooltip: DataScience.jupyterSelectURINewDetail
    };
    private commandUrls = new Map<string, string>();
    public async resolveConnectionInformation(server: JupyterServer, _token: CancellationToken) {
        const serverInfo = await this.getServerUri(server.id);
        return {
            baseUrl: Uri.parse(serverInfo.baseUrl),
            token: serverInfo.token,
            authorizationHeader: serverInfo.authorizationHeader,
            mappedRemoteNotebookDir: serverInfo.mappedRemoteNotebookDir
                ? Uri.file(serverInfo.mappedRemoteNotebookDir)
                : undefined,
            webSocketProtocols: serverInfo.webSocketProtocols
        };
    }
    public async handleCommand(command: JupyterServerCommand): Promise<void | JupyterServer | 'back' | undefined> {
        const token = new CancellationTokenSource();
        const url = this.commandUrls.get(command.title) || '';
        try {
            const handleOrBack = await this.handleQuickPick(url);
            if (!handleOrBack) {
                return;
            }
            if (handleOrBack === 'back') {
                return 'back';
            }
            const servers = await this.getJupyterServers(token.token);
            const server = servers.find((s) => s.id === handleOrBack);
            if (!server) {
                throw new Error(`Server ${handleOrBack} not found`);
            }
            return server;
        } catch (ex) {
            traceError(`Failed to select a Jupyter Server`, ex);
            return;
        }
    }
    activate() {
        const collection = this.jupyterServerProviderRegistry.createJupyterServerCollection(
            JVSC_EXTENSION_ID,
            this.id,
            this.displayName
        );
        this.disposables.push(collection);
        collection.commandProvider = this;
        collection.serverProvider = this;
        collection.documentation = this.documentation;
        this.onDidChangeHandles(() => this._onDidChangeServers.fire(), this, this.disposables);
        this.commands.registerCommand('jupyter.selectLocalJupyterServer', async (url?: string) => {
            try {
                await this.handleQuickPick(url);
            } catch (ex) {
                traceError(`Failed to select a Jupyter Server`, ex);
            }
        });
        this._localDisposables.push(
            this.commands.registerCommand('dataScience.ClearUserProviderJupyterServerCache', async () => {
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
    /**
     * @param value Value entered by the user in the quick pick
     */
    async getCommands(value: string, _token: CancellationToken): Promise<JupyterServerCommand[]> {
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
            this.commandUrls.clear();
            this.commandUrls.set(DataScience.connectToToTheJupyterServer(url), url);
            return [{ title: DataScience.connectToToTheJupyterServer(url) }];
        }
        return [
            {
                title: DataScience.jupyterSelectURIPrompt,
                tooltip: DataScience.jupyterSelectURINewDetail,
                picked: true
            }
        ];
    }
    async getJupyterServers(_token: CancellationToken): Promise<JupyterServer[]> {
        await this.initializeServers();
        const servers = await this.newStorage.getServers(false);
        return servers.map((s) => {
            return {
                id: s.handle,
                label: s.serverInfo.displayName,
                remove: async () => {
                    await this.initializeServers();
                    await this.newStorage.remove(s.handle);
                    this._onDidChangeHandles.fire();
                }
            };
        });
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
    async handleQuickPick(url: string = ''): Promise<string | undefined> {
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
        if (url) {
            // Validate the URI first, which would otherwise be validated when user enters the Uri into the input box.
            const initialVerification = this.jupyterServerUriInput.parseUserUriAndGetValidationError(url);
            if (typeof initialVerification.validationError === 'string') {
                // Uri has an error, show the error message by displaying the input box and pre-populating the url.
                validationErrorMessage = initialVerification.validationError;
                nextStep = 'Get Url';
            } else {
                jupyterServerUri = initialVerification.jupyterServerUri;
                nextStep = 'Check Passwords';
            }
        }
        try {
            while (true) {
                try {
                    handle = uuid();
                    if (nextStep === 'Get Url') {
                        nextStep = 'Check Passwords';
                        previousStep = undefined;
                        const errorMessage = validationErrorMessage;
                        validationErrorMessage = ''; // Never display this validation message again.
                        const result = await this.jupyterServerUriInput.getUrlFromUser(url, errorMessage, disposables);
                        jupyterServerUri = result.jupyterServerUri;
                        url = result.url;
                    }

                    if (nextStep === 'Check Passwords') {
                        nextStep = 'Check Insecure Connections';
                        previousStep = 'Get Url';

                        try {
                            const errorMessage = validationErrorMessage;
                            validationErrorMessage = ''; // Never display this validation message again.
                            const result = await this.passwordConnect.getPasswordConnectionInfo({
                                url: jupyterServerUri.baseUrl,
                                isTokenEmpty: jupyterServerUri.token.length === 0,
                                handle,
                                displayName: jupyterServerUri.displayName,
                                validationErrorMessage: errorMessage,
                                disposables
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
                        }
                    }

                    if (nextStep === 'Check Insecure Connections') {
                        // If we do not have any auth header information & there is no token & no password,
                        // & this is HTTP then this is an insecure server
                        // & we need to ask the user for consent to use this insecure server.
                        nextStep = 'Verify Connection';
                        previousStep =
                            requiresPassword && jupyterServerUri.token.length === 0 ? 'Check Passwords' : 'Get Url';
                        if (
                            !requiresPassword &&
                            jupyterServerUri.token.length === 0 &&
                            new URL(jupyterServerUri.baseUrl).protocol.toLowerCase() === 'http:'
                        ) {
                            isInsecureConnection = true;
                            const proceed = await this.secureConnectionValidator.promptToUseInsecureConnections();
                            if (!proceed) {
                                return;
                            }
                        }
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
                                continue;
                            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                                validationErrorMessage = DataScience.jupyterSelfCertExpiredErrorMessageOnly;
                                nextStep = 'Get Url';
                                continue;
                            } else if (requiresPassword && jupyterServerUri.token.length === 0) {
                                validationErrorMessage = DataScience.passwordFailure;
                                nextStep = 'Check Passwords';
                                continue;
                            } else {
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
                        }
                    }

                    if (nextStep === 'Get Display Name') {
                        previousStep = isInsecureConnection
                            ? 'Check Insecure Connections'
                            : requiresPassword && jupyterServerUri.token.length === 0
                            ? 'Check Passwords'
                            : 'Get Url';
                        jupyterServerUri.displayName = await this.jupyterServerUriDisplayName.getDisplayName(
                            handle,
                            jupyterServerUri.displayName || new URL(jupyterServerUri.baseUrl).hostname
                        );
                        break;
                    }
                } catch (ex) {
                    if (ex instanceof CancellationError || ex === InputFlowAction.cancel) {
                        // This means exit all of this, & do not event go back
                        return;
                    }
                    if (ex === InputFlowAction.back) {
                        if (!previousStep) {
                            // Go back to the beginning of this workflow, ie. back to calling code.
                            return 'back';
                        }
                        nextStep = previousStep;
                        continue;
                    }

                    throw ex;
                }
            }

            await this.addNewServer({
                handle,
                uri: url,
                serverInfo: jupyterServerUri
            });
            return handle;
        } finally {
            disposeAllDisposables(disposables);
        }
    }
    private async addNewServer(server: { handle: string; uri: string; serverInfo: IJupyterServerUri }) {
        await this.newStorage.add(server);
        this._onDidChangeHandles.fire();
    }
    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        const servers = await this.newStorage.getServers(false);
        const server = servers.find((s) => s.handle === handle);
        if (!server) {
            throw new Error('Server not found');
        }
        const serverInfo = server.serverInfo;
        // Hacky due to the way display names are stored in uri storage.
        // Should be cleaned up later.
        const displayName = this.jupyterServerUriDisplayName.displayNamesOfHandles.get(handle);
        if (displayName) {
            serverInfo.displayName = displayName;
        }

        const passwordResult = await this.passwordConnect.getPasswordConnectionInfo({
            url: serverInfo.baseUrl,
            isTokenEmpty: serverInfo.token.length === 0,
            displayName: serverInfo.displayName,
            handle
        });
        return Object.assign({}, serverInfo, {
            authorizationHeader: passwordResult.requestHeaders || serverInfo.authorizationHeader
        });
    }
}

export class UserJupyterServerUriInput {
    constructor(
        @inject(IClipboard) private readonly clipboard: IClipboard,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell
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
        input.title = DataScience.jupyterSelectURIPrompt;
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
            const result = this.parseUserUriAndGetValidationError(input.value);
            if (typeof result.validationError === 'string') {
                input.validationMessage = result.validationError;
                return;
            }
            deferred.resolve(result);
        });
        return deferred.promise;
    }

    public parseUserUriAndGetValidationError(
        value: string
    ): { validationError: string } | { jupyterServerUri: IJupyterServerUri; url: string; validationError: undefined } {
        // If it ends with /lab? or /lab or /tree? or /tree, then remove that part.
        const uri = value.trim().replace(/\/(lab|tree)(\??)$/, '');
        const jupyterServerUri = parseUri(uri, '');
        if (!jupyterServerUri) {
            return { validationError: DataScience.jupyterSelectURIInvalidURI };
        }
        if (!uri.toLowerCase().startsWith('http:') && !uri.toLowerCase().startsWith('https:')) {
            return { validationError: DataScience.jupyterSelectURIMustBeHttpOrHttps };
        }
        return { jupyterServerUri, url: uri, validationError: undefined };
    }
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
            return deferred.promise;
        } finally {
            disposeAllDisposables(disposables);
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
            disposeAllDisposables(disposables);
        }
        return deferred.promise;
    }
}
function parseUri(uri: string, displayName?: string): IJupyterServerUri | undefined {
    // This is a url that we crafted. It's not a valid Jupyter Server Url.
    if (uri.startsWith(Identifiers.REMOTE_URI)) {
        return;
    }
    try {
        const url = new URL(uri);

        // Special case for URI's ending with 'lab'. Remove this from the URI. This is not
        // the location for connecting to jupyterlab
        const baseUrl = `${url.protocol}//${url.host}${url.pathname === '/lab' ? '' : url.pathname}`;

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
