// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import * as vscode from 'vscode';
import { Extensions } from '../../../platform/common/application/extensions.node';
import { FileSystem } from '../../../platform/common/platform/fileSystem.node';
import { JupyterUriProviderRegistration } from './jupyterUriProviderRegistration';
import { IInternalJupyterUriProvider, IJupyterServerUriEntry, IJupyterServerUriStorage } from '../types';
import { IDisposable } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IJupyterServerUri, JupyterServerUriHandle } from '../../../api';
import { IServiceContainer } from '../../../platform/ioc/types';

class MockProvider implements IInternalJupyterUriProvider {
    public get id() {
        return this._id;
    }
    private currentBearer = 1;
    private result: string = '1';
    public readonly extensionId: string = 'foo.bar';
    constructor(private readonly _id: string) {
        // Id should be readonly
    }
    public getQuickPickEntryItems(): vscode.QuickPickItem[] {
        return [{ label: 'Foo' }];
    }
    public async handleQuickPick(
        _item: vscode.QuickPickItem,
        back: boolean
    ): Promise<JupyterServerUriHandle | 'back' | undefined> {
        return back ? 'back' : this.result;
    }
    public async getServerUri(handle: string): Promise<IJupyterServerUri> {
        if (handle === '1') {
            return {
                // eslint-disable-next-line
                baseUrl: 'http://foobar:3000',
                token: '',
                displayName: 'dummy',
                authorizationHeader: { Bearer: this.currentBearer.toString() }
            };
        }

        throw new Error('Invalid server uri handle');
    }
}

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('URI Picker', () => {
    const disposables: IDisposable[] = [];
    teardown(() => {
        sinon.restore();
        disposeAllDisposables(disposables);
    });
    suiteSetup(() => sinon.restore());
    async function createRegistration(providerIds: string[]) {
        let registration: JupyterUriProviderRegistration | undefined;
        const extensionList: vscode.Extension<any>[] = [];
        const fileSystem = mock(FileSystem);
        const allStub = sinon.stub(Extensions.prototype, 'all');
        allStub.callsFake(() => extensionList);
        const extensions = new Extensions(instance(fileSystem));
        when(fileSystem.exists(anything())).thenResolve(false);
        const memento = mock<vscode.Memento>();
        when(memento.get<string[]>(anything())).thenReturn([]);
        when(memento.get<string[]>(anything(), anything())).thenReturn([]);
        const uriStorage = mock<IJupyterServerUriStorage>();
        const onDidRemove = new vscode.EventEmitter<IJupyterServerUriEntry[]>();
        disposables.push(onDidRemove);
        when(uriStorage.onDidRemove).thenReturn(onDidRemove.event);
        const serviceContainer = mock<IServiceContainer>();
        when(serviceContainer.get<IJupyterServerUriStorage>(IJupyterServerUriStorage)).thenReturn(instance(uriStorage));
        registration = new JupyterUriProviderRegistration(
            extensions,
            disposables,
            instance(memento),
            instance(serviceContainer)
        );
        providerIds.map(async (id) => {
            const extension = TypeMoq.Mock.ofType<vscode.Extension<any>>();
            const packageJson = TypeMoq.Mock.ofType<any>();
            const contributes = TypeMoq.Mock.ofType<any>();
            extension.setup((e) => e.packageJSON).returns(() => packageJson.object);
            packageJson.setup((p) => p.contributes).returns(() => contributes.object);
            contributes.setup((p) => p.pythonRemoteServerProvider).returns(() => [{ d: '' }]);
            extension
                .setup((e) => e.activate())
                .returns(() => {
                    return Promise.resolve();
                });
            extension.setup((e) => e.isActive).returns(() => false);
            extensionList.push(extension.object);
            registration?.registerProvider(new MockProvider(id), '1');
        });
        return registration;
    }

    test('Simple', async () => {
        const registration = await createRegistration(['1']);
        const pickers = registration.providers;
        assert.equal(pickers.length, 1, 'Default picker should be there');
        const quickPick = await pickers[0].getQuickPickEntryItems!();
        assert.equal(quickPick.length, 1, 'No quick pick items added');
        const handle = await pickers[0].handleQuickPick!(quickPick[0], false);
        assert.ok(handle, 'Handle not set');
        const uri = await registration.getJupyterServerUri('1', handle!);
        // eslint-disable-next-line
        assert.equal(uri.baseUrl, 'http://foobar:3000', 'Base URL not found');
        assert.equal(uri.displayName, 'dummy', 'Display name not found');
    });
    test('Back', async () => {
        const registration = await createRegistration(['1']);
        const pickers = registration.providers;
        assert.equal(pickers.length, 1, 'Default picker should be there');
        const quickPick = await pickers[0].getQuickPickEntryItems!();
        assert.equal(quickPick.length, 1, 'No quick pick items added');
        const handle = await pickers[0].handleQuickPick!(quickPick[0], true);
        assert.equal(handle, 'back', 'Should be sending back');
    });
    test('Error', async () => {
        const registration = await createRegistration(['1']);
        const pickers = registration.providers;
        assert.equal(pickers.length, 1, 'Default picker should be there');
        const quickPick = await pickers[0].getQuickPickEntryItems!();
        assert.equal(quickPick.length, 1, 'No quick pick items added');
        try {
            await registration.getJupyterServerUri('1', 'foobar');
            // eslint-disable-next-line
            assert.fail('Should not get here');
        } catch {
            // This means test passed.
        }
    });
    test('No picker call', async () => {
        const registration = await createRegistration(['1']);
        const uri = await registration.getJupyterServerUri('1', '1');
        // eslint-disable-next-line
        assert.equal(uri.baseUrl, 'http://foobar:3000', 'Base URL not found');
    });
    test('Two pickers', async () => {
        const registration = await createRegistration(['1', '2']);
        let uri = await registration.getJupyterServerUri('1', '1');
        // eslint-disable-next-line
        assert.equal(uri.baseUrl, 'http://foobar:3000', 'Base URL not found');
        uri = await registration.getJupyterServerUri('2', '1');
        // eslint-disable-next-line
        assert.equal(uri.baseUrl, 'http://foobar:3000', 'Base URL not found');
    });
    test('Two pickers with same id', async () => {
        try {
            const registration = await createRegistration(['1', '1']);
            await registration.getJupyterServerUri('1', '1');
            // eslint-disable-next-line
            assert.fail('Should have failed if calling with same picker');
        } catch {
            // This means it passed
        }
    });
});
