// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
suite('Dummy7', () => {
    test('dummy7', () => {
        //
    });
});
// import assert from 'assert';

// import { Event, EventEmitter, Extension, ExtensionKind, QuickPickItem, Uri } from 'vscode';
// import { IExtensions } from '../../platform/common/types';
// import { sleep } from '../../platform/common/utils/async';
// import { Identifiers } from '../../platform/datascience/constants';
// import {
//     IJupyterExecution,
//     IJupyterServerUri,
//     IJupyterUriProvider,
//     IJupyterUriProviderRegistration
// } from '../../platform/datascience/types';
// import { DataScienceIocContainer } from './dataScienceIocContainer';

// const TestUriProviderId = 'TestUriProvider_Id';
// const TestUriHandle = 'TestUriHandle';

// class TestUriProvider implements IJupyterUriProvider {
//     public id: string = TestUriProviderId;
//     public currentBearer = 0;
//     public getQuickPickEntryItems(): QuickPickItem[] {
//         throw new Error('Method not implemented.');
//     }
//     public handleQuickPick(_item: QuickPickItem, _backEnabled: boolean): Promise<string | undefined> {
//         throw new Error('Method not implemented.');
//     }
//     public async getServerUri(handle: string): Promise<IJupyterServerUri> {
//         if (handle === TestUriHandle) {
//             this.currentBearer += 1;
//             return {
//                 // eslint-disable-next-line
//                 baseUrl: 'http://foobar:3000',
//                 displayName: 'test',
//                 token: '',
//                 authorizationHeader: { Bearer: this.currentBearer.toString() },
//                 expiration: new Date(Date.now() + 300) // Expire after 300 milliseconds
//             };
//         }

//         throw new Error('Invalid server uri handle');
//     }
// }

// /* eslint-disable @typescript-eslint/no-explicit-any */
// class TestUriProviderExtension implements Extension<any> {
//     public id: string = '1';
//     public extensionUri: Uri = Uri.parse('foo');
//     public extensionPath: string = 'foo';
//     public isActive: boolean = false;
//     public packageJSON: any = {
//         contributes: {
//             pythonRemoteServerProvider: []
//         }
//     };
//     public extensionKind: ExtensionKind = ExtensionKind.Workspace;
//     public exports: any = {};
//     constructor(private ioc: DataScienceIocContainer) {}
//     public async activate() {
//         this.ioc
//             .get<IJupyterUriProviderRegistration>(IJupyterUriProviderRegistration)
//             .registerProvider(new TestUriProvider());
//         this.isActive = true;
//         return {};
//     }
// }

// class UriMockExtensions implements IExtensions {
//     public all: Extension<any>[] = [];
//     private changeEvent = new EventEmitter<void>();
//     constructor(ioc: DataScienceIocContainer) {
//         this.all.push(new TestUriProviderExtension(ioc));
//     }
//     public getExtension<T>(_extensionId: string): Extension<T> | undefined {
//         return undefined;
//     }

//     public get onDidChange(): Event<void> {
//         return this.changeEvent.event;
//     }
//     public async determineExtensionFromCallStack(): Promise<{ extensionId: string; displayName: string }> {
//         return { displayName: '', extensionId: '' };
//     }
// }

// /* eslint-disable , comma-dangle, @typescript-eslint/no-explicit-any, no-multi-str */
// suite(`DataScience JupyterServerUriProvider tests`, () => {
//     let ioc: DataScienceIocContainer;

//     setup(async () => {
//         ioc = new DataScienceIocContainer();
//         // Force to always be a mock run. Real will try to connect to the dummy URI
//         ioc.shouldMockJupyter = true;
//         ioc.registerDataScienceTypes(false);
//         ioc.serviceManager.rebindInstance<IExtensions>(IExtensions, new UriMockExtensions(ioc));
//         return ioc.activate();
//     });

//     teardown(async () => {
//         await ioc.dispose();
//     });

//     test('Expiration', async function () {
//         // Only run with mock so we don't try to really start a remote server
//         if (!ioc.mockJupyter) {
//             // eslint-disable-next-line no-invalid-this
//             return this.skip();
//         }

//         // Set the URI to id value.
//         const uri = `${Identifiers.REMOTE_URI}?${Identifiers.REMOTE_URI_ID_PARAM}=${TestUriProviderId}&${Identifiers.REMOTE_URI_HANDLE_PARAM}=${TestUriHandle}`;
//         await ioc.setServerUri(uri);

//         // Start a notebook server (should not actually start anything as it's remote)
//         const jupyterExecution = ioc.get<IJupyterExecution>(IJupyterExecution);
//         const server = await jupyterExecution.connectToNotebookServer({
//             uri,
//             purpose: 'history',
//             allowUI: () => false,
//             resource: undefined
//         });

//         // Verify URI is our expected one
//         // eslint-disable-next-line
//         assert.equal(server?.getConnectionInfo()?.baseUrl, `http://foobar:3000`, 'Base URI is invalid');
//         let authHeader = server?.getConnectionInfo()?.getAuthHeader?.call(undefined);
//         assert.deepEqual(authHeader, { Bearer: '1' }, 'Bearer token invalid');

//         // Wait a bit
//         await sleep(1000);

//         authHeader = server?.getConnectionInfo()?.getAuthHeader?.call(undefined);

//         // Auth header should have updated
//         assert.notEqual(authHeader.Bearer, '1', 'Bearer token did not update');
//     });
// });
