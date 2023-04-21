// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable , @typescript-eslint/no-explicit-any, @typescript-eslint/no-extraneous-class */

import { inject, injectable } from 'inversify';
import {
    Disposable,
    Event,
    QuickInput,
    QuickInputButton,
    QuickInputButtons,
    QuickPick,
    QuickPickItem,
    QuickPickItemButtonEvent
} from 'vscode';
import { IApplicationShell } from '../application/types';
import { disposeAllDisposables } from '../helpers';
import { createDeferred } from './async';

// Borrowed from https://github.com/Microsoft/vscode-extension-samples/blob/master/quickinput-sample/src/multiStepInput.ts
// Why re-invent the wheel :)

export class InputFlowAction {
    public static back = new InputFlowAction();
    public static cancel = new InputFlowAction();
    public static resume = new InputFlowAction();
}

export type InputStep<T extends any> = (input: MultiStepInput<T>, state: T) => Promise<InputStep<T> | void>;

export interface IQuickPickParameters<T extends QuickPickItem> {
    title?: string;
    step?: number;
    totalSteps?: number;
    items: T[];
    activeItem?: T;
    placeholder: string;
    buttons?: QuickInputButton[];
    onDidTriggerButton?: (e: QuickInputButton) => void;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    acceptFilterBoxTextAsSelection?: boolean;
    startBusy?: boolean;
    stopBusy?: Event<void>;
    validate?(selection: T | QuickPick<T>): Promise<string | undefined>;
    shouldResume?(): Promise<boolean>;
    /**
     * Displays a back button on the first step which allows one to go back to the calling code,
     * Will return InputFlowAction.back
     */
    supportBackInFirstStep?: boolean;
    onDidTriggerItemButton?(e: QuickPickItemButtonEvent<T>): void;
    onDidChangeItems?: Event<T[]>;
    /**
     * Whether to close the quick pick when the user clicks outside the quickpick.
     */
    ignoreFocusOut?: boolean;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface InputBoxParameters {
    title: string;
    password?: boolean;
    step?: number;
    totalSteps?: number;
    value: string;
    prompt: string;
    buttons?: QuickInputButton[];
    validate(value: string): Promise<string | undefined>;
    shouldResume?(): Promise<boolean>;
}

export type MultiStepInputQuickPicResponseType<T, P> = T | (P extends { buttons: (infer I)[] } ? I : never);
type MultiStepInputInputBoxResponseType<P> = string | (P extends { buttons: (infer I)[] } ? I : never);
/**
 * Interface used to provide a series of QuickPicks and input boxes to the user. Back buttons allow the user to move back to the previous step.
 * This is generally implemented by just bringing up the same QuickPick or InputBox again.
 */
export interface IMultiStepInput<S> {
    run(start: InputStep<S>, state: S): Promise<InputFlowAction | undefined>;
    showQuickPick<T extends QuickPickItem, P extends IQuickPickParameters<T>>({
        title,
        step,
        totalSteps,
        items,
        activeItem,
        placeholder,
        buttons,
        shouldResume
    }: P): Promise<MultiStepInputQuickPicResponseType<T, P>>;
    showLazyLoadQuickPick<T extends QuickPickItem, P extends IQuickPickParameters<T>>({
        title,
        step,
        totalSteps,
        items,
        activeItem,
        placeholder,
        buttons,
        shouldResume
    }: P): { quickPick: QuickPick<T>; selection: Promise<MultiStepInputQuickPicResponseType<T, P>> };
    showInputBox<P extends InputBoxParameters>({
        title,
        step,
        totalSteps,
        value,
        prompt,
        validate,
        buttons,
        shouldResume
    }: P): Promise<MultiStepInputInputBoxResponseType<P>>;
}

export class MultiStepInput<S> implements IMultiStepInput<S> {
    private current?: QuickInput;
    private steps: InputStep<S>[] = [];
    constructor(private readonly shell: IApplicationShell) {}
    public run(start: InputStep<S>, state: S) {
        return this.stepThrough(start, state);
    }

    public async showQuickPick<T extends QuickPickItem, P extends IQuickPickParameters<T>>(
        options: P
    ): Promise<MultiStepInputQuickPicResponseType<T, P>> {
        return this.showLazyLoadQuickPick<T, P>(options).selection;
    }

    public showLazyLoadQuickPick<T extends QuickPickItem, P extends IQuickPickParameters<T>>({
        title,
        step,
        totalSteps,
        items,
        activeItem,
        placeholder,
        buttons,
        shouldResume,
        matchOnDescription,
        matchOnDetail,
        acceptFilterBoxTextAsSelection,
        startBusy,
        stopBusy,
        validate,
        onDidTriggerItemButton,
        onDidTriggerButton,
        supportBackInFirstStep,
        onDidChangeItems,
        ignoreFocusOut
    }: P): { quickPick: QuickPick<T>; selection: Promise<MultiStepInputQuickPicResponseType<T, P>> } {
        const disposables: Disposable[] = [];
        const deferred = createDeferred<MultiStepInputQuickPicResponseType<T, P>>();
        const input = this.shell.createQuickPick<T>();
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.placeholder = placeholder;
        input.ignoreFocusOut = ignoreFocusOut ?? true;
        input.items = items;
        if (stopBusy) {
            input.busy = startBusy ?? false;
            stopBusy(
                () => {
                    if (input.enabled) {
                        input.busy = false;
                    }
                },
                this,
                disposables
            );
        }
        if (onDidChangeItems) {
            input.keepScrollPosition = true;
            onDidChangeItems(
                (newItems) => {
                    input.items = newItems;
                },
                this,
                disposables
            );
        }
        if (onDidTriggerItemButton) {
            input.onDidTriggerItemButton((e) => onDidTriggerItemButton(e), undefined, disposables);
        }
        input.matchOnDescription = matchOnDescription || false;
        input.matchOnDetail = matchOnDetail || false;
        if (activeItem) {
            input.activeItems = [activeItem];
        } else {
            input.activeItems = [];
        }
        input.buttons = [
            ...(this.steps.length > 1 || supportBackInFirstStep ? [QuickInputButtons.Back] : []),
            ...(buttons || [])
        ];
        disposables.push(
            input.onDidTriggerButton((item) => {
                if (item === QuickInputButtons.Back) {
                    deferred.reject(InputFlowAction.back);
                } else if (onDidTriggerButton) {
                    onDidTriggerButton(item);
                } else {
                    deferred.resolve(<any>item);
                }
            }),
            input.onDidChangeSelection(async (selectedItems) => {
                const itemLabel = selectedItems.length ? selectedItems[0].label : '';
                let resolvable = itemLabel ? true : false;
                if (itemLabel && validate && selectedItems.length) {
                    input.enabled = false;
                    input.busy = true;
                    const message = await validate(selectedItems[0]);
                    if (message) {
                        resolvable = false;
                        // No validation allowed on a quick pick. Have to put up a dialog instead
                        await this.shell.showErrorMessage(message, { modal: true });
                    }
                    input.enabled = true;
                    input.busy = false;
                }
                if (resolvable) {
                    deferred.resolve(selectedItems[0]);
                }
            }),
            input.onDidHide(() => {
                (async () => {
                    deferred.reject(
                        shouldResume && (await shouldResume()) ? InputFlowAction.resume : InputFlowAction.cancel
                    );
                })().catch(deferred.reject);
            })
        );
        if (acceptFilterBoxTextAsSelection) {
            disposables.push(
                input.onDidAccept(async () => {
                    if (!input.busy) {
                        const validationMessage = validate ? await validate(input) : undefined;
                        if (!validationMessage) {
                            deferred.resolve(<any>input.value);
                        } else {
                            input.enabled = false;
                            input.busy = true;
                            // No validation allowed on a quick pick. Have to put up a dialog instead
                            await this.shell.showErrorMessage(validationMessage);
                            input.enabled = true;
                            input.busy = false;
                        }
                    }
                })
            );
        }
        if (this.current) {
            this.current.dispose();
        }
        this.current = input;
        this.current.show();
        deferred.promise.finally(() => disposeAllDisposables(disposables));
        return { quickPick: input, selection: deferred.promise };
    }

    public async showInputBox<P extends InputBoxParameters>({
        title,
        step,
        totalSteps,
        value,
        prompt,
        validate,
        password,
        buttons,
        shouldResume
    }: P): Promise<MultiStepInputInputBoxResponseType<P>> {
        const disposables: Disposable[] = [];
        try {
            return await new Promise<MultiStepInputInputBoxResponseType<P>>((resolve, reject) => {
                const input = this.shell.createInputBox();
                input.title = title;
                input.step = step;
                input.totalSteps = totalSteps;
                input.password = password ? true : false;
                input.value = value || '';
                input.prompt = prompt;
                input.ignoreFocusOut = true;
                input.buttons = [...(this.steps.length > 1 ? [QuickInputButtons.Back] : []), ...(buttons || [])];
                disposables.push(
                    input.onDidTriggerButton((item) => {
                        if (item === QuickInputButtons.Back) {
                            reject(InputFlowAction.back);
                        } else {
                            resolve(<any>item);
                        }
                    }),
                    input.onDidAccept(async () => {
                        const inputValue = input.value;
                        input.enabled = false;
                        input.busy = true;
                        const validationMessage = await validate(inputValue);
                        if (!validationMessage) {
                            input.validationMessage = '';
                            resolve(inputValue);
                        } else {
                            input.validationMessage = validationMessage;

                            // On validation error make sure we are showing our input
                            input.show();
                        }
                        input.enabled = true;
                        input.busy = false;
                    }),
                    input.onDidChangeValue(async () => {
                        // Validation happens on acceptance. Just clear as the user types
                        input.validationMessage = '';
                    }),
                    input.onDidHide(() => {
                        (async () => {
                            // If we are busy we might be validating, which might pop up new UI like the password UI, which triggers a hide here
                            // In that case don't reject, promise can wait and continue after validation is done
                            if (!input.busy) {
                                reject(
                                    shouldResume && (await shouldResume())
                                        ? InputFlowAction.resume
                                        : InputFlowAction.cancel
                                );
                            }
                        })().catch(reject);
                    })
                );
                if (this.current) {
                    this.current.dispose();
                }
                this.current = input;
                this.current.show();
            });
        } finally {
            disposables.forEach((d) => d.dispose());
        }
    }

    private async stepThrough(start: InputStep<S>, state: S): Promise<InputFlowAction | undefined> {
        let step: InputStep<S> | void = start;
        while (step) {
            this.steps.push(step);
            if (this.current) {
                this.current.enabled = false;
                this.current.busy = true;
            }
            try {
                step = await step(this, state);
            } catch (err) {
                if (err === InputFlowAction.back) {
                    this.steps.pop();
                    step = this.steps.pop();
                } else if (err === InputFlowAction.resume) {
                    step = this.steps.pop();
                } else if (err === InputFlowAction.cancel) {
                    step = undefined;
                } else {
                    throw err;
                }
                if (!step) {
                    return err;
                }
            }
        }
        if (this.current) {
            this.current.dispose();
        }
    }
}
export const IMultiStepInputFactory = Symbol('IMultiStepInputFactory');
export interface IMultiStepInputFactory {
    create<S>(): IMultiStepInput<S>;
}
@injectable()
export class MultiStepInputFactory {
    constructor(@inject(IApplicationShell) private readonly shell: IApplicationShell) {}
    public create<S>(): IMultiStepInput<S> {
        return new MultiStepInput<S>(this.shell);
    }
}
