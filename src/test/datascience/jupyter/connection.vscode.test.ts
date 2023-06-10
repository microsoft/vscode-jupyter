// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IApplicationShell,
    IClipboard,
    ICommandManager,
    IEncryptedStorage
} from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { IExtensionTestApi } from '../../common.node';
import { IS_REMOTE_NATIVE_TEST, initialize } from '../../initialize.node';
import { startJupyterServer, closeNotebooksAndCleanUpAfterTests } from '../notebook/helper.node';
import { UserJupyterServerUrlProvider } from '../../../standalone/userJupyterServer/userServerUrlProvider';
import { IJupyterUriProviderRegistration, JupyterServerProviderHandle } from '../../../kernels/jupyter/types';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { IJupyterPasswordConnect } from '../../../standalone/userJupyterServer/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { anything, capture, instance, mock, when } from 'ts-mockito';
import { Disposable, InputBox, Memento, QuickPickItem } from 'vscode';
import { noop } from '../../../platform/common/utils/misc';
import { DataScience } from '../../../platform/common/utils/localize';
import * as sinon from 'sinon';
import assert from 'assert';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { createDeferred, createDeferredFromPromise } from '../../../platform/common/utils/async';
import { IJupyterServerUri } from '../../../api';

suite('Connect to Remote Jupyter Servers', function () {
    let api: IExtensionTestApi;
    // On conda these take longer for some reason.
    this.timeout(120_000);
    let jupyterNotebookWithHelloPassword = '';
    let jupyterLabWithHelloPasswordAndWorldToken = '';
    let jupyterNotebookWithHelloToken = '';
    let jupyterNotebookWithEmptyPasswordToken = '';
    let jupyterLabWithHelloPasswordAndEmptyToken = '';
    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST()) {
            return;
        }
        api = await initialize();
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

    let clipboard: IClipboard;
    let uriProviderRegistration: IJupyterUriProviderRegistration;
    let appShell: IApplicationShell;
    let encryptedStorage: IEncryptedStorage;
    let memento: Memento;
    const disposables: IDisposable[] = [];
    let userUriProvider: UserJupyterServerUrlProvider;
    let commands: ICommandManager;
    const quickPick: QuickPickItem = {
        label: DataScience.jupyterSelectURIPrompt
    };
    let inputBox: InputBox;
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
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
        uriProviderRegistration = mock<IJupyterUriProviderRegistration>();
        appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        encryptedStorage = mock<IEncryptedStorage>();
        memento = mock<Memento>();
        commands = mock<ICommandManager>();
        when(uriProviderRegistration.registerProvider(anything(), anything())).thenReturn(new Disposable(noop));
        when(commands.registerCommand(anything(), anything())).thenReturn(new Disposable(noop));
        when(memento.get(anything())).thenReturn(undefined);
        when(memento.get(anything(), anything())).thenCall((_, defaultValue) => defaultValue);
        when(memento.update(anything(), anything())).thenResolve();
        when(encryptedStorage.retrieve(anything())).thenResolve();
        when(encryptedStorage.store(anything(), anything())).thenResolve();
        sinon.stub(appShell, 'createInputBox').callsFake(() => inputBox);

        userUriProvider = new UserJupyterServerUrlProvider(
            instance(clipboard),
            instance(uriProviderRegistration),
            api.serviceContainer.get<IApplicationShell>(IApplicationShell),
            api.serviceContainer.get<JupyterConnection>(JupyterConnection),
            false,
            instance(encryptedStorage),
            instance(memento),
            disposables,
            api.serviceContainer.get<IJupyterPasswordConnect>(IJupyterPasswordConnect),
            instance(commands)
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
        sinon.stub(inputBox, 'validationMessage').set((msg) => errorMessageDisplayed.resolve(msg));
        const handlePromise = createDeferredFromPromise(userUriProvider.handleQuickPick(quickPick, false));

        await Promise.race([handlePromise.promise, errorMessageDisplayed.promise]);

        if (failWithInvalidPassword) {
            assert.strictEqual(errorMessageDisplayed.value, DataScience.passwordFailure);
            assert.ok(!handlePromise.completed);
        } else {
            const { serverHandle, serverInfo } = JSON.parse(
                capture(encryptedStorage.store).first()[1] as string
            )[0] as {
                serverHandle: JupyterServerProviderHandle;
                serverInfo: IJupyterServerUri;
            };

            assert.ok(serverHandle);
            assert.ok(serverInfo);
            assert.strictEqual(serverHandle.handle, handlePromise.value, 'Invalid handle');
            assert.strictEqual(serverHandle.extensionId, JVSC_EXTENSION_ID, 'Invalid Extension Id');
            assert.strictEqual(serverInfo.baseUrl, `http://localhost:${new URL(userUri).port}/`, 'Invalid BaseUrl');
            assert.strictEqual(serverInfo.displayName, `Title of Server`, 'Invalid Title');
        }
    }

    test('Connect to server with Token in URL', () =>
        testConnection({ userUri: jupyterNotebookWithHelloToken, password: undefined }));
    test('Connect to server with Password and Token in URL', () =>
        testConnection({ userUri: jupyterNotebookWithHelloPassword, password: 'Hello' }));
    test('Connect to Notebook server with Password and no Token in URL', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterNotebookWithHelloPassword).port}/`,
            password: 'Hello'
        }));
    test('Connect to Lab server with Password and no Token in URL', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterLabWithHelloPasswordAndWorldToken).port}/`,
            password: 'Hello'
        }));
    test('Connect to server with Invalid Password', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterNotebookWithHelloPassword).port}/`,
            password: 'Bogus',
            failWithInvalidPassword: true
        }));
    test('Connect to server with Password & Token in URL', () =>
        testConnection({ userUri: jupyterLabWithHelloPasswordAndWorldToken, password: 'Hello' }));
    test('Connect to server with empty Password & empty Token in URL', () =>
        testConnection({ userUri: jupyterNotebookWithEmptyPasswordToken, password: undefined }));
    test('Connect to server with empty Password & empty Token (nothing in URL)', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterNotebookWithEmptyPasswordToken).port}/`,
            password: undefined
        }));
    test('Connect to server with Hello Password & empty Token (not even in URL)', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterLabWithHelloPasswordAndEmptyToken).port}/`,
            password: 'Hello'
        }));
    test('Connect to server with bogus Password & empty Token (not even in URL)', () =>
        testConnection({
            userUri: `http://localhost:${new URL(jupyterLabWithHelloPasswordAndEmptyToken).port}/`,
            password: 'Bogus',
            failWithInvalidPassword: true
        }));
});
