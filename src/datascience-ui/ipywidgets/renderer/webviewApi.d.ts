/* eslint-disable @typescript-eslint/no-explicit-any */
interface Disposable {
    dispose(): void;
}

export interface Event<T> {
    (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
}

declare global {
    export interface IVsCodeApi {
        postMessage(msg: any): void;
        setState(state: any): void;
        getState(): any;
    }
    function acquireVsCodeApi(): IVsCodeApi;
}
