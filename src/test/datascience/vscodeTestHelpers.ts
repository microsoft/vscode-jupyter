interface IOnMessage {
    onMessage(message: string, payload: any): void;
}

// IANHU: Same as mounted webview? Share?
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
    // tslint:disable-next-line: no-any
    withPayload?(payload: any): boolean;
};

export class OnMessageListener {
    public onMessage(message: string, payload: any) {
        console.log(`#### ${message}`);
    }
}

// Wrap anything that supports the onMessage(message: string, payload: any): void
export class OnMessageWrapper {
    private wrappedClass: IOnMessage;
    private originalOnMessage;

    constructor(wrapped: IOnMessage) {
        this.wrappedClass = wrapped;

        // Patch out the onMessage function with our interceptor
        this.originalOnMessage = this.wrappedClass.onMessage;
        this.wrappedClass.onMessage = this.onMessage;
    }

    public async waitForMessage(message: string, options?: WaitForMessageOptions): Promise<void> {
        //const timeoutMs = options && options.timeoutMs ? options.timeoutMs : undefined;
        //const numberOfTimes = options && options.numberOfTimes ? options.numberOfTimes : 1;
    }

    private onMessage(message: string, payload: any): void {
        // Last thing call the original onMessage
        this.originalOnMessage(message, payload);
    }
}

//public async waitForMessage(message: string, options?: WaitForMessageOptions): Promise<void> {
//const timeoutMs = options && options.timeoutMs ? options.timeoutMs : undefined;
//const numberOfTimes = options && options.numberOfTimes ? options.numberOfTimes : 1;
//// Wait for the mounted web panel to send a message back to the data explorer
//const promise = createDeferred<void>();
//traceInfo(`Waiting for message ${message} with timeout of ${timeoutMs}`);
//let handler: (m: string, p: any) => void;
//const timer = timeoutMs
//? setTimeout(() => {
//if (!promise.resolved) {
//promise.reject(new Error(`Waiting for ${message} timed out`));
//}
//}, timeoutMs)
//: undefined;
//let timesMessageReceived = 0;
//const dispatchedAction = `DISPATCHED_ACTION_${message}`;
//handler = (m: string, payload: any) => {
//if (m === message || m === dispatchedAction) {
//// First verify the payload matches
//if (options?.withPayload) {
//if (!options.withPayload(payload)) {
//return;
//}
//}

//timesMessageReceived += 1;
//if (timesMessageReceived < numberOfTimes) {
//return;
//}
//if (timer) {
//clearTimeout(timer);
//}
//this.removeMessageListener(handler);
//// Make sure to rerender current state.
//if (this.wrapper) {
//this.wrapper.update();
//}
//if (m === message) {
//promise.resolve();
//} else {
//// It could a redux dispatched message.
//// Wait for 10ms, wait for other stuff to finish.
//// We can wait for 100ms or 1s. But thats too long.
//// The assumption is that currently we do not have any setTimeouts
//// in UI code that's in the magnitude of 100ms or more.
//// We do have a couple of setTiemout's, but they wait for 1ms, not 100ms.
//// 10ms more than sufficient for all the UI timeouts.
//setTimeout(() => promise.resolve(), 10);
//}
//}
//};

//this.addMessageListener(handler);
//return promise.promise;
//}
