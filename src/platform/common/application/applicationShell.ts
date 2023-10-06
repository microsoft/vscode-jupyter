// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any, @typescript-eslint/unified-signatures */

import { injectable } from 'inversify';
import {
    CancellationToken,
    CancellationTokenSource,
    ColorTheme,
    Disposable,
    env,
    Event,
    InputBox,
    InputBoxOptions,
    MessageItem,
    MessageOptions,
    OpenDialogOptions,
    OutputChannel,
    Progress,
    ProgressOptions,
    QuickPick,
    QuickPickItem,
    QuickPickOptions,
    SaveDialogOptions,
    StatusBarAlignment,
    StatusBarItem,
    TreeView,
    TreeViewOptions,
    Uri,
    window,
    WindowState,
    WorkspaceFolder,
    WorkspaceFolderPickOptions
} from 'vscode';
import { noop } from '../utils/misc';
import { IApplicationShell } from './types';

/**
 * Singleton wrapper around the VS code window namespace. Makes for easier mocking.
 */
@injectable()
export class ApplicationShell implements IApplicationShell {
    public get activeColorTheme(): ColorTheme {
        return window.activeColorTheme;
    }
    public get onDidChangeWindowState(): Event<WindowState> {
        return window.onDidChangeWindowState;
    }
    public showInformationMessage(message: string, ...items: string[]): Thenable<string>;
    public showInformationMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string>;
    public showInformationMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T>;
    public showInformationMessage<T extends MessageItem>(
        message: string,
        options: MessageOptions,
        ...items: T[]
    ): Thenable<T>;
    public showInformationMessage(message: string, options?: any, ...items: any[]): Thenable<any> {
        return window.showInformationMessage(message, options, ...items);
    }

    public showWarningMessage(message: string, ...items: string[]): Thenable<string>;
    public showWarningMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string>;
    public showWarningMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T>;
    public showWarningMessage<T extends MessageItem>(
        message: string,
        options: MessageOptions,
        ...items: T[]
    ): Thenable<T>;
    public showWarningMessage(message: any, options?: any, ...items: any[]) {
        return window.showWarningMessage(message, options, ...items);
    }

    public showErrorMessage(message: string, ...items: string[]): Thenable<string>;
    public showErrorMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string>;
    public showErrorMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T>;
    public showErrorMessage<T extends MessageItem>(
        message: string,
        options: MessageOptions,
        ...items: T[]
    ): Thenable<T>;
    public showErrorMessage(message: any, options?: any, ...items: any[]) {
        return window.showErrorMessage(message, options, ...items);
    }

    public showQuickPick(
        items: string[] | Thenable<string[]>,
        options?: QuickPickOptions,
        token?: CancellationToken
    ): Thenable<string>;
    public showQuickPick<T extends QuickPickItem>(
        items: T[] | Thenable<T[]>,
        options?: QuickPickOptions,
        token?: CancellationToken
    ): Thenable<T>;
    public showQuickPick(items: any, options?: any, token?: any): Thenable<any> {
        return window.showQuickPick(items, options, token);
    }

    public showOpenDialog(options: OpenDialogOptions): Thenable<Uri[] | undefined> {
        return window.showOpenDialog(options);
    }
    public showSaveDialog(options: SaveDialogOptions): Thenable<Uri | undefined> {
        return window.showSaveDialog(options);
    }
    public showInputBox(options?: InputBoxOptions, token?: CancellationToken): Thenable<string | undefined> {
        return window.showInputBox(options, token);
    }
    public openUrl(url: string): void {
        env.openExternal(Uri.parse(url)).then(noop, noop);
    }

    public setStatusBarMessage(text: string, hideAfterTimeout: number): Disposable;
    public setStatusBarMessage(text: string, hideWhenDone: Thenable<any>): Disposable;
    public setStatusBarMessage(text: string): Disposable;
    public setStatusBarMessage(text: string, arg?: any): Disposable {
        return window.setStatusBarMessage(text, arg);
    }

    public createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem {
        return window.createStatusBarItem(alignment, priority);
    }
    public showWorkspaceFolderPick(options?: WorkspaceFolderPickOptions): Thenable<WorkspaceFolder | undefined> {
        return window.showWorkspaceFolderPick(options);
    }
    public withProgress<R>(
        options: ProgressOptions,
        task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Thenable<R>
    ): Thenable<R> {
        return window.withProgress<R>(options, task);
    }
    public withProgressCustomIcon<R>(
        icon: string,
        task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Thenable<R>
    ): Thenable<R> {
        const token = new CancellationTokenSource().token;
        const statusBarProgress = this.createStatusBarItem(StatusBarAlignment.Left);
        const progress = {
            report: (value: { message?: string; increment?: number }) => {
                statusBarProgress.text = `${icon} ${value.message}`;
            }
        };
        statusBarProgress.show();
        return task(progress, token).then((result) => {
            statusBarProgress.dispose();
            return result;
        });
    }
    public createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
        return window.createQuickPick<T>();
    }
    public createInputBox(): InputBox {
        return window.createInputBox();
    }
    public createTreeView<T>(viewId: string, options: TreeViewOptions<T>): TreeView<T> {
        return window.createTreeView<T>(viewId, options);
    }
    public createOutputChannel(name: string): OutputChannel {
        return window.createOutputChannel(name);
    }
}
