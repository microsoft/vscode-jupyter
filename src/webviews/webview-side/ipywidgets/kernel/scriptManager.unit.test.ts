// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Disposable } from 'vscode';
import { disposeAllDisposables } from '../../../../platform/common/helpers';
import { IDisposable } from '../../../../platform/common/types';
import { IInteractiveWindowMapping, IPyWidgetMessages } from '../../../../messageTypes';
import { IMessageHandler, PostOffice } from '../../react-common/postOffice';
import { sleep } from '../../../../test/core';
import { scriptsAlreadyRegisteredInRequireJs } from './requirejsRegistry';
import { ScriptManager } from './scriptManager';

suite('IPyWidget Script Manager', () => {
    let scriptManager: ScriptManager;
    let postOffice: PostOffice;
    let postOfficeCallBack: IMessageHandler;
    let requireConfigPaths = {};
    const disposables: IDisposable[] = [];
    setup(() => {
        scriptsAlreadyRegisteredInRequireJs.clear();
        requireConfigPaths = {};
        (globalThis as any).window = {
            requirejs: {
                config: (cfg: { paths: {} }) => {
                    Object.assign(requireConfigPaths, cfg['paths']);
                },
                define: () => {
                    //
                }
            }
        };
        postOffice = mock<PostOffice>();
        when(postOffice.addHandler(anything())).thenCall((handler: IMessageHandler) => {
            postOfficeCallBack = handler;
        });
    });
    teardown(() => {
        scriptsAlreadyRegisteredInRequireJs.clear();
        delete (globalThis as any).window;
        // Just to
        if (postOfficeCallBack?.dispose) {
            postOfficeCallBack.dispose();
        }
        disposeAllDisposables(disposables);
        scriptManager.dispose();
    });
    function createManager(isOnline: boolean) {
        scriptManager = new ScriptManager(instance(postOffice), Promise.resolve(isOnline));
    }
    test('Verify we send the isOnline flag when we are online', async () => {
        createManager(true);
        await sleep(0);
        verify(
            postOffice.sendMessage<IInteractiveWindowMapping>(
                IPyWidgetMessages.IPyWidgets_IsOnline,
                deepEqual({ isOnline: true })
            )
        ).once();
    });
    test('Verify we send the isOnline flag when we are not online', async () => {
        createManager(false);
        await sleep(0);
        verify(
            postOffice.sendMessage<IInteractiveWindowMapping>(
                IPyWidgetMessages.IPyWidgets_IsOnline,
                deepEqual({ isOnline: false })
            )
        ).once();
    });
    test('Register scripts as and when they are provided by extension host', async () => {
        createManager(true);

        postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
            moduleName: 'widget1',
            source: 'local',
            scriptUri: 'http://bogus.com/1'
        });
        postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
            moduleName: 'widget2',
            source: 'local',
            scriptUri: 'http://bogus.com/2'
        });

        // Verify we registered the modules in requirejs.
        assert.deepEqual(requireConfigPaths, { widget1: 'http://bogus.com/1', widget2: 'http://bogus.com/2' });
    });
    test('Override local widget script source with CDN', async () => {
        createManager(true);

        postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
            moduleName: 'widget1',
            source: 'local',
            scriptUri: 'http://bogus.com/1'
        });
        postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
            moduleName: 'widget2',
            source: 'local',
            scriptUri: 'http://bogus.com/2'
        });

        // Verify we registered the modules in requirejs.
        assert.deepEqual(requireConfigPaths, { widget1: 'http://bogus.com/1', widget2: 'http://bogus.com/2' });

        let payload: { moduleName: string; moduleVersion: string; requestId: string } | undefined;
        when(postOffice.sendMessage<IInteractiveWindowMapping>(anything(), anything())).thenCall((arg1, arg2) => {
            if (arg1 === IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest) {
                payload = arg2;
            }
        });

        const promise = scriptManager.loadWidgetScript('widget1', '1');
        await sleep(0);
        // Send the response back to the manager.
        postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
            moduleName: 'widget1',
            source: 'cdn',
            requestId: payload?.requestId,
            scriptUri: 'http://bogus.com/1cdn'
        });

        // Promise should now complete.
        await promise;

        // Verify we registered the modules in requirejs.
        assert.deepEqual(requireConfigPaths, { widget1: 'http://bogus.com/1cdn', widget2: 'http://bogus.com/2' });
    });
    test('Do not overwrite cdn widget script source with local', async () => {
        createManager(true);

        postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
            moduleName: 'widget1',
            source: 'cdn',
            scriptUri: 'http://bogus.com/1cdn'
        });
        postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
            moduleName: 'widget2',
            source: 'local',
            scriptUri: 'http://bogus.com/2'
        });

        // Verify we registered the modules in requirejs.
        assert.deepEqual(requireConfigPaths, { widget1: 'http://bogus.com/1cdn', widget2: 'http://bogus.com/2' });

        let payload: { moduleName: string; moduleVersion: string; requestId: string } | undefined;
        when(postOffice.sendMessage<IInteractiveWindowMapping>(anything(), anything())).thenCall((arg1, arg2) => {
            if (arg1 === IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest) {
                payload = arg2;
            }
        });

        const promise = scriptManager.loadWidgetScript('widget1', '1');
        await sleep(0);
        // Send the response back to the manager.
        postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
            moduleName: 'widget1',
            source: 'local',
            requestId: payload?.requestId,
            scriptUri: 'http://bogus.com/1local'
        });

        // Promise should now complete.
        await promise;

        // Verify we registered the modules in requirejs.
        assert.deepEqual(requireConfigPaths, { widget1: 'http://bogus.com/1cdn', widget2: 'http://bogus.com/2' });
    });
    test('Fetch widget script source', async () => {
        createManager(true);

        let payload: { moduleName: string; moduleVersion: string; requestId: string } | undefined;
        when(postOffice.sendMessage<IInteractiveWindowMapping>(anything(), anything())).thenCall((arg1, arg2) => {
            if (arg1 === IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest) {
                payload = arg2;
            }
        });

        const promise = scriptManager.loadWidgetScript('helloWorld', '1');

        disposables.push(
            new Disposable(() => {
                postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
                    moduleName: 'helloWorld',
                    requestId: payload?.requestId
                });
            })
        );
        // Verify we sent the request to fetch the widget script source
        await sleep(0);
        verify(
            postOffice.sendMessage<IInteractiveWindowMapping>(
                IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest,
                anything()
            )
        ).once();

        assert.strictEqual(payload?.moduleName, 'helloWorld');
        assert.strictEqual(payload?.moduleVersion, '1');

        // Send the response back to the manager.
        postOfficeCallBack.handleMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse, {
            moduleName: 'helloWorld',
            requestId: payload?.requestId,
            scriptUri: 'http://bogus.com/helloWorld'
        });

        // Promise should now complete.
        await promise;

        // Verify we registered the modules in requirejs.
        assert.deepEqual(requireConfigPaths, { helloWorld: 'http://bogus.com/helloWorld' });
    });
});
