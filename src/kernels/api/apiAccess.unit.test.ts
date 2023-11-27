// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { when, instance, mock, anything, verify, reset } from 'ts-mockito';
import { Disposable, EventEmitter, Extension, ExtensionMode, SecretStorage, SecretStorageChangeEvent } from 'vscode';
import { clearApiAccess, requestApiAccess, updateListOfExtensionsAllowedToAccessApi } from './apiAccess';
import { JVSC_EXTENSION_ID } from '../../platform/common/constants';
import { mockedVSCodeNamespaces } from '../../test/vscode-mock';
import { IDisposable, IDisposableRegistry, IExtensionContext } from '../../platform/common/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { Common } from '../../platform/common/utils/localize';
import { ServiceContainer } from '../../platform/ioc/container';
import { noop } from '../../test/core';

suite('Kernel Api Access', () => {
    let disposables: IDisposable[] = [];
    let context: IExtensionContext;
    let secrets: SecretStorage;
    let onDidChangeSecrets: EventEmitter<SecretStorageChangeEvent>;
    const secretStorage = new Map<string, string>();
    setup(() => {
        clearApiAccess();
        reset(mockedVSCodeNamespaces.window);
        when(mockedVSCodeNamespaces.workspace.isTrusted).thenReturn(true);

        secretStorage.clear();
        context = mock<IExtensionContext>();
        secrets = mock<SecretStorage>();
        onDidChangeSecrets = new EventEmitter<SecretStorageChangeEvent>();
        const serviceContainer = mock<ServiceContainer>();
        sinon.stub(ServiceContainer, 'instance').get(() => instance(serviceContainer));
        when(serviceContainer.get<IExtensionContext>(IExtensionContext)).thenReturn(instance(context));
        when(serviceContainer.get<IDisposableRegistry>(IDisposableRegistry)).thenReturn(
            disposables as unknown as IDisposableRegistry
        );
        when(context.extensionMode).thenReturn(ExtensionMode.Production);
        when(context.secrets).thenReturn(instance(secrets));
        when(secrets.onDidChange).thenReturn(onDidChangeSecrets.event);
        when(secrets.get(anything())).thenCall((key) => secretStorage.get(key));
        when(secrets.store(anything(), anything())).thenCall((key, value) => {
            secretStorage.set(key, value);
            onDidChangeSecrets.fire({ key });
            return Promise.resolve();
        });

        disposables.push(new Disposable(() => sinon.restore()));
        disposables.push(new Disposable(() => clearApiAccess()));
    });
    teardown(() => (disposables = dispose(disposables)));
    test('Jupyter Extension should always have access', async () => {
        const { accessAllowed } = await requestApiAccess(JVSC_EXTENSION_ID);

        assert.isTrue(accessAllowed);
    });
    test('No access when Workspace is not trusteed', async () => {
        when(mockedVSCodeNamespaces.workspace.isTrusted).thenReturn(false);
        const { accessAllowed } = await requestApiAccess(JVSC_EXTENSION_ID);

        assert.isFalse(accessAllowed);
    });
    test('Disallow access if Extension does not exist (or is invalid)', async () => {
        when(mockedVSCodeNamespaces.extensions.all).thenReturn([]);
        when(mockedVSCodeNamespaces.extensions.getExtension(anything())).thenReturn(undefined);

        const { accessAllowed } = await requestApiAccess('SomeBogus.Extension');

        assert.isFalse(accessAllowed);
    });
    test('Display prompt & disallow access when extension attempts to access API', async () => {
        const extension = mock<Extension<any>>();
        when(extension.packageJSON).thenReturn({ displayName: 'Test Extension' });
        const extensionId = 'hello.world';
        when(mockedVSCodeNamespaces.extensions.getExtension(extensionId)).thenReturn(instance(extension));
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).thenResolve(undefined);

        const { accessAllowed } = await requestApiAccess(extensionId);

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).once();
        assert.isFalse(accessAllowed);
    });
    test('Display a single prompt when extension attempts to access API multiple times', async () => {
        const extension = mock<Extension<any>>();
        when(extension.packageJSON).thenReturn({ displayName: 'Test Extension' });
        const extensionId = 'hello.world';
        when(mockedVSCodeNamespaces.extensions.getExtension(extensionId)).thenReturn(instance(extension));
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).thenResolve(undefined);

        requestApiAccess(extensionId).catch(noop);
        requestApiAccess(extensionId).catch(noop);
        requestApiAccess(extensionId).catch(noop);
        requestApiAccess(extensionId).catch(noop);
        requestApiAccess(extensionId).catch(noop);
        const { accessAllowed } = await requestApiAccess(extensionId);

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).once();
        assert.isFalse(accessAllowed);
    });
    test('Display prompt & allow access when extension attempts to access API', async () => {
        const extension = mock<Extension<any>>();
        when(extension.packageJSON).thenReturn({ displayName: 'Test Extension' });
        const extensionId = 'hello.world';
        when(mockedVSCodeNamespaces.extensions.getExtension(extensionId)).thenReturn(instance(extension));
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).thenResolve(Common.bannerLabelYes as any);

        const { accessAllowed } = await requestApiAccess(extensionId);

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).once();
        assert.isTrue(accessAllowed);
    });
    test('Once access has been granted do not display prompts again', async () => {
        const extension = mock<Extension<any>>();
        when(extension.packageJSON).thenReturn({ displayName: 'Test Extension' });
        const extensionId = 'hello.world';
        when(mockedVSCodeNamespaces.extensions.getExtension(extensionId)).thenReturn(instance(extension));
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).thenResolve(Common.bannerLabelYes as any);

        const { accessAllowed } = await requestApiAccess(extensionId);

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).once();
        reset(mockedVSCodeNamespaces.window);
        assert.isTrue(accessAllowed);

        assert.isTrue(await requestApiAccess(extensionId).then(({ accessAllowed }) => accessAllowed));
        assert.isTrue(await requestApiAccess(extensionId).then(({ accessAllowed }) => accessAllowed));
        requestApiAccess(extensionId).catch(noop);
        requestApiAccess(extensionId).catch(noop);
        requestApiAccess(extensionId).catch(noop);
        requestApiAccess(extensionId).catch(noop);
        assert.isTrue(await requestApiAccess(extensionId).then(({ accessAllowed }) => accessAllowed));

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).never();
    });

    test('When access is granted manually, verify access check works', async () => {
        const extension = mock<Extension<any>>();
        when(extension.packageJSON).thenReturn({ displayName: 'Test Extension' });
        const extensionId = 'hello.world';
        when(mockedVSCodeNamespaces.extensions.getExtension(extensionId)).thenReturn(instance(extension));
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).thenResolve(undefined);

        let accessAllowed = await requestApiAccess(extensionId).then(({ accessAllowed }) => accessAllowed);

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).once();
        assert.isFalse(accessAllowed);

        reset(mockedVSCodeNamespaces.window);

        // Update access
        await updateListOfExtensionsAllowedToAccessApi([extensionId]);

        accessAllowed = await requestApiAccess(extensionId).then(({ accessAllowed }) => accessAllowed);
        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).never();
        assert.isTrue(accessAllowed);
    });
    test('When access has been manually revoked, ensure access check fails', async () => {
        const extension = mock<Extension<any>>();
        when(extension.packageJSON).thenReturn({ displayName: 'Test Extension' });
        const extensionId = 'hello.world';
        when(mockedVSCodeNamespaces.extensions.getExtension(extensionId)).thenReturn(instance(extension));
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).thenResolve(Common.bannerLabelYes as any);

        let accessAllowed = await requestApiAccess(extensionId).then(({ accessAllowed }) => accessAllowed);

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                Common.bannerLabelYes,
                Common.learnMore
            )
        ).once();
        assert.isTrue(accessAllowed);

        await updateListOfExtensionsAllowedToAccessApi([]);

        accessAllowed = await requestApiAccess(extensionId).then(({ accessAllowed }) => accessAllowed);
        assert.isFalse(accessAllowed);
    });
});
