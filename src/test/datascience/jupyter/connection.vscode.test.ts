// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IApplicationShell,
    IClipboard,
    ICommandManager,
    IEncryptedStorage
} from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IExtensionContext
} from '../../../platform/common/types';
import { IS_REMOTE_NATIVE_TEST, initialize } from '../../initialize.node';
import { startJupyterServer, closeNotebooksAndCleanUpAfterTests } from '../notebook/helper.node';
import { hijackPrompt } from '../notebook/helper';
import {
    EnterJupyterServerUriCommand,
    UserJupyterServerDisplayName,
    UserJupyterServerUriInput,
    UserJupyterServerUrlProvider,
    parseUri
} from '../../../standalone/userJupyterServer/userServerUrlProvider';
import {
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterServerProviderRegistry,
    IJupyterServerUriEntry,
    IJupyterServerUriStorage
} from '../../../kernels/jupyter/types';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { anything, instance, mock, when } from 'ts-mockito';
import { Disposable, EventEmitter, InputBox, Memento } from 'vscode';
import { noop } from '../../../platform/common/utils/misc';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import * as sinon from 'sinon';
import assert from 'assert';
import { createDeferred, createDeferredFromPromise } from '../../../platform/common/utils/async';
import { IMultiStepInputFactory, InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import { IFileSystem } from '../../../platform/common/platform/types';
import { JupyterServer } from '../../../api';

suite('Connect to Remote Jupyter Servers', function () {
    // On conda these take longer for some reason.
    this.timeout(120_000);
    let jupyterNotebookWithHelloPassword = { url: '', dispose: noop };
    let jupyterLabWithHelloPasswordAndWorldToken = { url: '', dispose: noop };
    let jupyterNotebookWithHelloToken = { url: '', dispose: noop };
    let jupyterNotebookWithEmptyPasswordToken = { url: '', dispose: noop };
    let jupyterLabWithHelloPasswordAndEmptyToken = { url: '', dispose: noop };
    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        this.timeout(120_000);
        await initialize();
        [
            jupyterNotebookWithHelloPassword,
            jupyterLabWithHelloPasswordAndWorldToken,
            jupyterNotebookWithHelloToken,
            jupyterNotebookWithEmptyPasswordToken,
            jupyterLabWithHelloPasswordAndEmptyToken
        ] = await Promise.all([
            startJupyterServer({
                jupyterLab: false,
                password: 'Hello',
                standalone: true
            }),
            startJupyterServer({
                jupyterLab: true,
                password: 'Hello',
                token: 'World',
                standalone: true
            }),
            startJupyterServer({
                jupyterLab: false,
                token: 'Hello',
                standalone: true
            }),
            startJupyterServer({
                jupyterLab: false,
                password: '',
                token: '',
                standalone: true
            }),
            startJupyterServer({
                jupyterLab: false,
                password: 'Hello',
                token: '',
                standalone: true
            })
        ]);
    });
    suiteTeardown(() => {
        disposeAllDisposables([
            jupyterNotebookWithHelloPassword,
            jupyterLabWithHelloPasswordAndWorldToken,
            jupyterNotebookWithHelloToken,
            jupyterNotebookWithEmptyPasswordToken,
            jupyterLabWithHelloPasswordAndEmptyToken
        ]);
    });
    let clipboard: IClipboard;
    let appShell: IApplicationShell;
    let encryptedStorage: IEncryptedStorage;
    let memento: Memento;
    const disposables: IDisposable[] = [];
    let userUriProvider: UserJupyterServerUrlProvider;
    let commands: ICommandManager;
    let inputBox: InputBox;
    let addNewJupyterUriCommandHandler: (url?: string) => Promise<JupyterServer | 'back' | undefined>;
    setup(async function () {
        if (!IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        traceInfo(`Start Test ${this.currentTest?.title}`);
        const api = await initialize();
        inputBox = {
            show: noop,
            onDidAccept: noop as any,
            onDidHide: noop as any,
            hide: noop,
            dispose: noop as any,
            onDidChangeValue: noop as any,
            onDidTriggerButton: noop as any,
            valueSelection: undefined,
            totalSteps: undefined,
            validationMessage: '',
            busy: false,
            buttons: [],
            enabled: true,
            ignoreFocusOut: false,
            password: false,
            step: undefined,
            title: '',
            value: '',
            prompt: '',
            placeholder: ''
        };
        sinon.stub(inputBox, 'show').callsFake(noop);
        sinon.stub(inputBox, 'onDidAccept').callsFake((cb) => {
            cb();
            return new Disposable(noop);
        });
        sinon.stub(inputBox, 'onDidHide').callsFake(() => new Disposable(noop));
        clipboard = mock<IClipboard>();
        appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        encryptedStorage = mock<IEncryptedStorage>();
        memento = mock<Memento>();
        commands = mock<ICommandManager>();
        when(commands.registerCommand(anything(), anything())).thenReturn(new Disposable(noop));
        when(commands.registerCommand(EnterJupyterServerUriCommand, anything())).thenCall((_, cb) => {
            addNewJupyterUriCommandHandler = cb;
            return new Disposable(noop);
        });

        when(memento.get(anything())).thenReturn(undefined);
        when(memento.get(anything(), anything())).thenCall((_, defaultValue) => defaultValue);
        when(memento.update(anything(), anything())).thenResolve();
        when(encryptedStorage.retrieve(anything(), anything())).thenResolve();
        when(encryptedStorage.store(anything(), anything(), anything())).thenResolve();
        sinon.stub(appShell, 'createInputBox').callsFake(() => inputBox);
        const serverUriStorage = mock<IJupyterServerUriStorage>();
        when(serverUriStorage.getAll()).thenResolve([]);
        const onDidRemoveUriStorage = new EventEmitter<IJupyterServerUriEntry[]>();
        disposables.push(onDidRemoveUriStorage);
        when(serverUriStorage.onDidRemove).thenReturn(onDidRemoveUriStorage.event);

        const prompt = await hijackPrompt(
            'showWarningMessage',
            { contains: DataScience.insecureSessionMessage },
            { clickImmediately: true, result: Common.bannerLabelYes },
            disposables
        );
        disposables.push(prompt);

        userUriProvider = new UserJupyterServerUrlProvider(
            instance(clipboard),
            appShell,
            api.serviceContainer.get<IConfigurationService>(IConfigurationService),
            api.serviceContainer.get<JupyterConnection>(JupyterConnection),
            false,
            instance(encryptedStorage),
            instance(serverUriStorage),
            instance(memento),
            disposables,
            api.serviceContainer.get<IMultiStepInputFactory>(IMultiStepInputFactory),
            api.serviceContainer.get<IAsyncDisposableRegistry>(IAsyncDisposableRegistry),
            instance(commands),
            api.serviceContainer.get<IJupyterRequestAgentCreator>(IJupyterRequestAgentCreator),
            api.serviceContainer.get<IJupyterRequestCreator>(IJupyterRequestCreator),
            api.serviceContainer.get<IExtensionContext>(IExtensionContext),
            api.serviceContainer.get<IFileSystem>(IFileSystem),
            api.serviceContainer.get<IJupyterServerProviderRegistry>(IJupyterServerProviderRegistry)
        );
        userUriProvider.activate();

        traceInfo(`Start Test Completed ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`End Test ${this.currentTest?.title}`);
        sinon.restore();
        disposeAllDisposables(disposables);
        traceInfo(`End Test Completed ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    async function testConnection({
        password,
        userUri,
        failWithInvalidPassword
    }: {
        password?: string;
        userUri: string;
        failWithInvalidPassword?: boolean;
    }) {
        when(clipboard.readText()).thenResolve(userUri);
        sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser').resolves({
            url: userUri,
            jupyterServerUri: parseUri(userUri, '')!
        });
        sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName').resolves('Test Remove Server Name');
        sinon.stub(appShell, 'showInputBox').callsFake((opts) => {
            console.error(opts);
            if (opts?.prompt === DataScience.jupyterSelectPasswordPrompt) {
                return Promise.resolve(password);
            } else if (opts?.title === DataScience.jupyterRenameServer) {
                return Promise.resolve('Title of Server');
            }
            return Promise.resolve(undefined);
        });
        const errorMessageDisplayed = createDeferred<string>();
        inputBox.value = password || '';
        sinon.stub(inputBox, 'validationMessage').set((msg) => errorMessageDisplayed.resolve(msg));
        const handlePromise = createDeferredFromPromise(addNewJupyterUriCommandHandler(userUri));
        await Promise.race([handlePromise.promise, errorMessageDisplayed.promise]);

        if (failWithInvalidPassword) {
            assert.strictEqual(errorMessageDisplayed.value, DataScience.passwordFailure);
            assert.ok(!handlePromise.completed);
        } else {
            assert.equal(errorMessageDisplayed.value || '', '', 'Should not have displayed an error message');
            assert.ok(handlePromise.completed, 'Did not complete');
            const value = handlePromise.value;
            if (!value || value === 'back' || value instanceof InputFlowAction) {
                throw new Error(`Jupyter Server URI not entered, ${value}`);
            }
            assert.ok(value.id, 'Invalid Handle');

            // Once storage has been refactored, then enable these tests.
            // const { serverHandle, serverInfo } = JSON.parse(
            //     capture(encryptedStorage.store).first()[1] as string
            // )[0] as {
            //     serverHandle: JupyterServerProviderHandle;
            //     serverInfo: IJupyterServerUri;
            // };

            // assert.ok(serverHandle);
            // assert.ok(serverInfo);
            // assert.strictEqual(serverHandle.handle, handlePromise.value, 'Invalid handle');
            // assert.strictEqual(serverHandle.extensionId, JVSC_EXTENSION_ID, 'Invalid Extension Id');
            // assert.strictEqual(
            //     serverInfo.baseUrl,
            //     `http://localhost:${new URL(userUri).port}/`,
            //     'Invalid BaseUrl'
            // );
            // assert.strictEqual(serverInfo.displayName, `Title of Server`, 'Invalid Title');
        }
    }

    test('Connect to server with Token in URL', () =>
        testConnection({ userUri: jupyterNotebookWithHelloToken.url, password: undefined }));
    test('Connect to server with Password and Token in URL', () =>
        testConnection({ userUri: jupyterNotebookWithHelloPassword.url, password: 'Hello' }));
    test('Connect to Notebook server with Password and no Token in URL', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterNotebookWithHelloPassword.url).port}/`,
            password: 'Hello'
        }));
    test('Connect to Lab server with Password and no Token in URL', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterLabWithHelloPasswordAndWorldToken.url).port}/`,
            password: 'Hello'
        }));
    test('Connect to server with Invalid Password', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterNotebookWithHelloPassword.url).port}/`,
            password: 'Bogus',
            failWithInvalidPassword: true
        }));
    test('Connect to Lab server with Password & Token in URL', () =>
        testConnection({ userUri: jupyterLabWithHelloPasswordAndWorldToken.url, password: 'Hello' }));
    test('Connect to server with empty Password & empty Token in URL', () =>
        testConnection({ userUri: jupyterNotebookWithEmptyPasswordToken.url, password: '' }));
    test('Connect to server with empty Password & empty Token (nothing in URL)', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterNotebookWithEmptyPasswordToken.url).port}/`,
            password: ''
        }));
    test('Connect to Lab server with Hello Password & empty Token (not even in URL)', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterLabWithHelloPasswordAndEmptyToken.url).port}/`,
            password: 'Hello'
        }));
    test('Connect to Lab server with bogus Password & empty Token (not even in URL)', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterLabWithHelloPasswordAndEmptyToken.url).port}/`,
            password: 'Bogus',
            failWithInvalidPassword: true
        }));
});
