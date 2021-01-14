// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as fs from 'fs-extra';
import * as path from 'path';
import * as playwright from 'playwright-chromium';
import { IAsyncDisposable, IDisposable } from '../../../client/common/types';
import { createDeferred } from '../../../client/common/utils/async';
import { EXTENSION_ROOT_DIR } from '../../../client/constants';
import { InteractiveWindowMessages } from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import { CssMessages } from '../../../client/datascience/messages';
import { CommonActionType } from '../../../datascience-ui/interactive-common/redux/reducers/types';
import { noop } from '../../core';
import { IWebServer } from './webBrowserPanel';

/* eslint-disable , comma-dangle, @typescript-eslint/no-explicit-any, no-multi-str */
export type WaitForMessageOptions = {
    /**
     * Timeout for waiting for message.
     * Defaults to 65_000ms.
     *
     * @type {number}
     */
    timeoutMs?: number;
    /**
     * Number of times the message should be received.
     * Defaults to 1.
     *
     * @type {number}
     */
    numberOfTimes?: number;
};

export const maxWaitTimeForMessage = 75_000;
/**
 * UI could take a while to update, could be slower on CI server.
 * (500ms is generally enough, but increasing to 3s to avoid flaky CI tests).
 */
export const waitTimeForUIToUpdate = 10_000;

export class BaseWebUI implements IAsyncDisposable {
    public page?: playwright.Page;
    private readonly disposables: IDisposable[] = [];
    private readonly webServerPromise = createDeferred<IWebServer>();
    private webServer?: IWebServer;
    private browser?: playwright.ChromiumBrowser;
    public async dispose() {
        try {
            while (this.disposables.length) {
                this.disposables.shift()?.dispose(); // NOSONAR
            }
            await this.browser?.close();
            await this.page?.close();
        } catch {
            // Failure on dispose doesn't really matter.
        }
    }
    public async type(text: string): Promise<void> {
        await this.page?.keyboard.type(text);
    }
    public _setWebServer(webServer: IWebServer) {
        this.webServer = webServer;
        this.webServerPromise.resolve(webServer);
    }
    public async waitUntilLoaded(): Promise<void> {
        await this.webServerPromise.promise.then(() =>
            // The UI is deemed loaded when we have seen all of the following messages.
            // We cannot guarantee the order of these messages, however they are all part of the load process.
            Promise.all([
                this.waitForMessage(InteractiveWindowMessages.LoadAllCellsComplete),
                this.waitForMessage(InteractiveWindowMessages.LoadAllCells),
                this.waitForMessage(InteractiveWindowMessages.MonacoReady), // Sometimes the last thing to happen.
                this.waitForMessage(InteractiveWindowMessages.SettingsUpdated),
                this.waitForMessage(CommonActionType.EDITOR_LOADED),
                this.waitForMessage(CommonActionType.CODE_CREATED), // When a cell has been created.
                this.waitForMessage(CssMessages.GetMonacoThemeResponse),
                this.waitForMessage(CssMessages.GetCssResponse),
                this.page?.waitForLoadState()
            ])
        );
    }

    public waitForMessageAfterServer(message: string, options?: WaitForMessageOptions): Promise<void> {
        return this.webServerPromise.promise.then(() => this.waitForMessage(message, options));
    }
    public async waitForMessage(message: string, options?: WaitForMessageOptions): Promise<void> {
        if (!this.webServer) {
            throw new Error('WebServer not yet started');
        }
        const timeoutMs = options && options.timeoutMs ? options.timeoutMs : maxWaitTimeForMessage;
        const numberOfTimes = options && options.numberOfTimes ? options.numberOfTimes : 1;
        // Wait for the mounted web panel to send a message back to the data explorer
        const promise = createDeferred<void>();
        const timer = timeoutMs
            ? setTimeout(async () => {
                  if (!promise.resolved) {
                      // Take a screenshot and save at the root with the same name (upload on error)
                      await this.page
                          ?.screenshot({ path: path.join(EXTENSION_ROOT_DIR, 'browser-screenshot.png') })
                          .catch(noop);
                      promise.reject(new Error(`Waiting for ${message} timed out`));
                  }
              }, timeoutMs)
            : undefined;
        let timesMessageReceived = 0;
        const dispatchedAction = `DISPATCHED_ACTION_${message}`;
        const disposable = this.webServer.onDidReceiveMessage((msg) => {
            const messageType = msg.type;
            if (messageType !== message && messageType !== dispatchedAction) {
                return;
            }
            timesMessageReceived += 1;
            if (timesMessageReceived < numberOfTimes) {
                return;
            }
            if (timer) {
                clearTimeout(timer);
            }
            disposable.dispose();
            if (messageType === message) {
                promise.resolve();
            } else {
                // It could be a redux dispatched message.
                // Wait for 10ms, wait for other stuff to finish.
                // We can wait for 100ms or 1s. But thats too long.
                // The assumption is that currently we do not have any setTimeouts
                // in UI code that's in the magnitude of 100ms or more.
                // We do have a couple of setTimeout's, but they wait for 1ms, not 100ms.
                // 10ms more than sufficient for all the UI timeouts.
                setTimeout(() => promise.resolve(), 10);
            }
        });

        return promise.promise;
    }
    /**
     * Opens a browser an loads the webpage, effectively loading the UI.
     */
    public async loadUI(url: string) {
        // Configure to display browser while debugging.
        const openBrowser = process.env.VSC_JUPYTER_DS_UI_BROWSER !== undefined;
        this.browser = await playwright.chromium.launch({ headless: !openBrowser, devtools: openBrowser });
        await this.browser.newContext();
        this.page = await this.browser.newPage();
        await this.page.goto(url);
        this.page.route('**', (route) => {
            console.log(`Playwright browser Url requested ${route.request().url()}`);
            route.continue();
        });
        this.page.on('console', (output) => {
            try {
                // Log output for diagnostic purposes (see what errors & the like are printed in console).
                console.info(`IPyWidgets Browser: ${output.type()} ${output.text()}`);
            } catch {
                //
            }
        });
    }

    public async captureScreenshot(filePath: string): Promise<void> {
        if (!(await fs.pathExists(path.basename(filePath)))) {
            await fs.ensureDir(path.basename(filePath));
        }
        await this.page?.screenshot({ path: filePath });
        // eslint-disable-next-line no-console
        console.info(`Screenshot captured in ${filePath}`);
    }
}
