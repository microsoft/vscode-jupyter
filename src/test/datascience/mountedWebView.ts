import { ReactWrapper } from 'enzyme';
import { noop } from 'lodash';
import { Event, EventEmitter, Uri } from 'vscode';
import {
    IWebviewPanel,
    IWebviewPanelMessageListener,
    IWebviewPanelOptions,
    WebviewMessage
} from '../../client/common/application/types';
import { traceError, traceInfo } from '../../client/common/logger';
import { IDisposable } from '../../client/common/types';
import { createDeferred } from '../../client/common/utils/async';
import { InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { IVsCodeApi } from '../../datascience-ui/react-common/postOffice';

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

    // Optional check for the payload of the message
    // will only return (or count) message if this returns true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withPayload?(payload: any): boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IMountedWebView extends IWebviewPanel, IDisposable {
    readonly id: string;
    readonly wrapper: ReactWrapper<any, Readonly<{}>, React.Component>;
    readonly onDisposed: Event<void>;
    postMessage(ev: WebviewMessage): void;
    changeViewState(active: boolean, visible: boolean): void;
    addMessageListener(callback: (m: string, p: any) => void): void;
    removeMessageListener(callback: (m: string, p: any) => void): void;
    attach(options: IWebviewPanelOptions): void;
    waitForMessage(message: string, options?: WaitForMessageOptions): Promise<void>;
}

export class MountedWebView implements IMountedWebView, IDisposable {
    public wrapper: ReactWrapper<any, Readonly<{}>, React.Component>;
    private missedMessages: any[] = [];
    private webPanelListener: IWebviewPanelMessageListener | undefined;
    private reactMessageCallback: ((ev: MessageEvent) => void) | undefined;
    private extraListeners: ((m: string, p: any) => void)[] = [];
    private disposed = false;
    private active = true;
    private visible = true;
    private disposedEvent = new EventEmitter<void>();
    private loadFailedEmitter = new EventEmitter<void>();

    constructor(mount: () => ReactWrapper<any, Readonly<{}>, React.Component>, public readonly id: string) {
        // Setup the acquireVsCodeApi. The react control will cache this value when it's mounted.
        const globalAcquireVsCodeApi = (): IVsCodeApi => {
            return {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                postMessage: (msg: any) => {
                    this.postMessageToWebPanel(msg);
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty,@typescript-eslint/no-empty-function
                setState: (_msg: any) => {},
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty,@typescript-eslint/no-empty-function
                getState: () => {
                    return {};
                }
            };
        };
        // eslint-disable-next-line @typescript-eslint/dot-notation
        (global as any)['acquireVsCodeApi'] = globalAcquireVsCodeApi;

        // Remap event handlers to point to the container.
        const oldListener = window.addEventListener;
        window.addEventListener = (event: string, cb: any) => {
            if (event === 'message') {
                this.reactMessageCallback = cb;
            }
        };

        // Mount our main panel. This will make the global api be cached and have the event handler registered
        this.wrapper = mount();

        // We can remove the global api and event listener now.
        delete (global as any).acquireVsCodeApi;
        window.addEventListener = oldListener;
    }

    public get onDisposed() {
        return this.disposedEvent.event;
    }
    public get loadFailed(): Event<void> {
        return this.loadFailedEmitter.event;
    }
    public attach(options: IWebviewPanelOptions) {
        this.webPanelListener = options.listener;

        // During testing the MainPanel sends the init message before our interactive window is created.
        // Pretend like it's happening now (well after this function returns)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setTimeout(() => {
            this.webPanelListener!.onMessage(InteractiveWindowMessages.Started, {});
        }, 0);

        // Send messages that were already posted but were missed.
        // During normal operation, the react control will not be created before
        // the webPanelListener
        if (this.missedMessages.length && this.webPanelListener) {
            // This needs to be async because we are being called in the ctor of the webpanel. It can't
            // handle some messages during the ctor.
            setTimeout(() => {
                this.missedMessages.forEach((m) =>
                    this.webPanelListener ? this.webPanelListener.onMessage(m.type, m.payload) : noop()
                );
                this.missedMessages = [];
            }, 0);
        }
    }

    public async waitForMessage(message: string, options?: WaitForMessageOptions): Promise<void> {
        const timeoutMs = options && options.timeoutMs ? options.timeoutMs : undefined;
        const numberOfTimes = options && options.numberOfTimes ? options.numberOfTimes : 1;
        // Wait for the mounted web panel to send a message back to the data explorer
        const promise = createDeferred<void>();
        traceInfo(`Waiting for message ${message} with timeout of ${timeoutMs}`);
        let handler: (m: string, p: any) => void;
        const timer = timeoutMs
            ? setTimeout(() => {
                  if (!promise.resolved) {
                      promise.reject(new Error(`Waiting for ${message} timed out`));
                  }
              }, timeoutMs)
            : undefined;
        let timesMessageReceived = 0;
        const dispatchedAction = `DISPATCHED_ACTION_${message}`;
        handler = (m: string, payload: any) => {
            if (m === message || m === dispatchedAction) {
                // First verify the payload matches
                if (options?.withPayload) {
                    if (!options.withPayload(payload)) {
                        return;
                    }
                }

                timesMessageReceived += 1;
                if (timesMessageReceived < numberOfTimes) {
                    return;
                }
                if (timer) {
                    clearTimeout(timer);
                }
                this.removeMessageListener(handler);
                // Make sure to rerender current state.
                if (this.wrapper) {
                    this.wrapper.update();
                }
                if (m === message) {
                    promise.resolve();
                } else {
                    // It could a redux dispatched message.
                    // Wait for 10ms, wait for other stuff to finish.
                    // We can wait for 100ms or 1s. But thats too long.
                    // The assumption is that currently we do not have any setTimeouts
                    // in UI code that's in the magnitude of 100ms or more.
                    // We do have a couple of setTiemout's, but they wait for 1ms, not 100ms.
                    // 10ms more than sufficient for all the UI timeouts.
                    setTimeout(() => promise.resolve(), 10);
                }
            }
        };

        this.addMessageListener(handler);
        return promise.promise;
    }

    public asWebviewUri(localResource: Uri): Uri {
        return localResource;
    }
    public setTitle(_val: string): void {
        noop();
    }
    public async show(_preserveFocus: boolean): Promise<void> {
        noop();
    }
    public isVisible(): boolean {
        return this.visible;
    }
    public postMessage(m: WebviewMessage): void {
        // Actually send to the UI
        if (this.reactMessageCallback) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const reactHelpers = require('./reactHelpers') as typeof import('./reactHelpers');
            const message = reactHelpers.createMessageEvent(m);
            this.reactMessageCallback(message);
            if (m.payload) {
                delete m.payload;
            }
        }
    }
    public close(): void {
        noop();
    }
    public isActive(): boolean {
        return this.active;
    }
    public updateCwd(_cwd: string): void {
        noop();
    }
    public dispose() {
        if (!this.disposed) {
            this.disposed = true;
            if (this.wrapper.length) {
                this.wrapper.unmount();
            }
            this.disposedEvent.fire();
        }
    }

    public changeViewState(active: boolean, visible: boolean) {
        this.active = active;
        this.visible = visible;
        if (this.webPanelListener) {
            this.webPanelListener.onChangeViewState(this);
        }
    }
    public addMessageListener(callback: (m: string, p: any) => void) {
        this.extraListeners.push(callback);
    }

    public removeMessageListener(callback: (m: string, p: any) => void) {
        const index = this.extraListeners.indexOf(callback);
        if (index >= 0) {
            this.extraListeners.splice(index, 1);
        }
    }
    private postMessageToWebPanel(msg: any) {
        if (this.disposed && !msg.type.startsWith(`DISPATCHED`)) {
            traceError(`Posting to disposed mount.`);
        }
        if (this.webPanelListener) {
            this.webPanelListener.onMessage(msg.type, msg.payload);
        } else {
            this.missedMessages.push({ type: msg.type, payload: msg.payload });
        }
        if (this.extraListeners.length) {
            this.extraListeners.forEach((e) => e(msg.type, msg.payload));
        }

        // Clear out msg payload
        delete msg.payload;

        // unmount ourselves if this is the close message
        if (msg.type === InteractiveWindowMessages.NotebookClose) {
            this.dispose();
        }
    }
}
