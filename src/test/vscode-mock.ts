// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, instance, mock, when } from 'ts-mockito';
/* eslint-disable no-invalid-this, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

import * as vscode from 'vscode';
import { format } from '../platform/common/helpers';
import { noop } from '../platform/common/utils/misc';
import * as vscodeMocks from './mocks/vsc';
import { vscMockTelemetryReporter } from './mocks/vsc/telemetryReporter';
const Module = require('module');

type VSCode = typeof vscode;

const mockedVSCode: Partial<VSCode> = {};
export const mockedVSCodeNamespaces: { [P in keyof VSCode]: VSCode[P] } = {} as any;
const originalLoad = Module._load;

function generateMock<K extends keyof VSCode>(name: K): void {
    const mockedObj = mock<VSCode[K]>();
    (mockedVSCode as any)[name] = instance(mockedObj);
    mockedVSCodeNamespaces[name] = mockedObj;
}

export class MockCommands {
    public log: string[] = [];
    public registerCommand(_command: string, _callback: (...args: any[]) => any, _thisArg?: any): vscode.Disposable {
        return { dispose: noop };
    }

    public registerTextEditorCommand(
        _command: string,
        _callback: (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => void,
        _thisArg?: any
    ): vscode.Disposable {
        return { dispose: noop };
    }

    public executeCommand<T>(command: string, ..._rest: any[]): Thenable<T | undefined> {
        this.log.push(command);
        return Promise.resolve(undefined);
    }

    public getCommands(_filterInternal?: boolean): Thenable<string[]> {
        return Promise.resolve([]);
    }
}

class MockClipboard {
    private text: string = '';
    public readText(): Promise<string> {
        return Promise.resolve(this.text);
    }
    public async writeText(value: string): Promise<void> {
        this.text = value;
    }
}
export function initialize() {
    generateMock('workspace');
    generateMock('window');
    generateMock('languages');
    generateMock('env');
    generateMock('debug');
    generateMock('scm');
    generateMock('notebooks');
    generateMock('commands');

    when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([]);
    when(mockedVSCodeNamespaces.window.visibleNotebookEditors).thenReturn([]);
    // Use mock clipboard fo testing purposes.
    const clipboard = new MockClipboard();
    when(mockedVSCodeNamespaces.env.clipboard).thenReturn(clipboard);
    when(mockedVSCodeNamespaces.env.appName).thenReturn('Insider');

    // When upgrading to npm 9-10, this might have to change, as we could have explicit imports (named imports).
    Module._load = function (request: any, _parent: any) {
        if (request === 'vscode') {
            return mockedVSCode;
        }
        if (request === '@vscode/extension-telemetry') {
            return { default: vscMockTelemetryReporter as any };
        }
        // less files need to be in import statements to be converted to css
        // But we don't want to try to load them in the mock vscode
        if (/\.less$/.test(request)) {
            return;
        }
        return originalLoad.apply(this, arguments);
    };
}
mockedVSCode.l10n = {
    bundle: undefined,
    t: (
        arg1: string | { message: string; args?: string[] | Record<string, string> },
        ...restOfArguments: unknown[]
    ) => {
        if (typeof arg1 === 'string') {
            if (restOfArguments.length === 0) {
                return arg1;
            }
            if (typeof restOfArguments === 'object' && !Array.isArray(restOfArguments)) {
                throw new Error('Records for l10n.t() are not supported in the mock');
            }
            return format(arg1, ...restOfArguments);
        }
        if (typeof arg1 === 'object') {
            const message = arg1.message;
            const args = arg1.args || [];
            if (typeof args === 'object' && !Array.isArray(args)) {
                throw new Error('Records for l10n.t() are not supported in the mock');
            }
            if (args.length === 0) {
                return message;
            }
            return format(message, ...args);
        }
        return arg1;
    },
    uri: undefined
} as any;
mockedVSCode.MarkdownString = vscodeMocks.vscMock.MarkdownString;
mockedVSCode.MarkdownString = vscodeMocks.vscMock.MarkdownString;
mockedVSCode.Hover = vscodeMocks.vscMock.Hover;
mockedVSCode.Disposable = vscodeMocks.vscMock.Disposable as any;
mockedVSCode.ExtensionKind = vscodeMocks.vscMock.ExtensionKind;
mockedVSCode.ExtensionMode = vscodeMocks.vscMock.ExtensionMode;
mockedVSCode.CodeAction = vscodeMocks.vscMock.CodeAction;
mockedVSCode.EventEmitter = vscodeMocks.vscMock.EventEmitter;
mockedVSCode.CancellationError = vscodeMocks.vscMock.CancellationError;
mockedVSCode.CancellationTokenSource = vscodeMocks.vscMock.CancellationTokenSource;
mockedVSCode.CompletionItemKind = vscodeMocks.vscMock.CompletionItemKind;
mockedVSCode.SymbolKind = vscodeMocks.vscMock.SymbolKind;
mockedVSCode.IndentAction = vscodeMocks.vscMock.IndentAction;
mockedVSCode.Uri = vscodeMocks.vscUri.URI as any;
mockedVSCode.Range = vscodeMocks.vscMockExtHostedTypes.Range;
mockedVSCode.Position = vscodeMocks.vscMockExtHostedTypes.Position;
mockedVSCode.Selection = vscodeMocks.vscMockExtHostedTypes.Selection;
mockedVSCode.Location = vscodeMocks.vscMockExtHostedTypes.Location;
mockedVSCode.SymbolInformation = vscodeMocks.vscMockExtHostedTypes.SymbolInformation;
mockedVSCode.CompletionItem = vscodeMocks.vscMockExtHostedTypes.CompletionItem;
mockedVSCode.CompletionItemKind = vscodeMocks.vscMockExtHostedTypes.CompletionItemKind;
mockedVSCode.CodeLens = vscodeMocks.vscMockExtHostedTypes.CodeLens;
mockedVSCode.Diagnostic = vscodeMocks.vscMockExtHostedTypes.Diagnostic;
mockedVSCode.CallHierarchyItem = vscodeMocks.vscMockExtHostedTypes.CallHierarchyItem;
mockedVSCode.DiagnosticSeverity = vscodeMocks.vscMockExtHostedTypes.DiagnosticSeverity;
mockedVSCode.SnippetString = vscodeMocks.vscMockExtHostedTypes.SnippetString;
mockedVSCode.ConfigurationTarget = vscodeMocks.vscMockExtHostedTypes.ConfigurationTarget;
mockedVSCode.StatusBarAlignment = vscodeMocks.vscMockExtHostedTypes.StatusBarAlignment;
mockedVSCode.SignatureHelp = vscodeMocks.vscMockExtHostedTypes.SignatureHelp;
mockedVSCode.DocumentLink = vscodeMocks.vscMockExtHostedTypes.DocumentLink;
mockedVSCode.TextEdit = vscodeMocks.vscMockExtHostedTypes.TextEdit;
mockedVSCode.WorkspaceEdit = vscodeMocks.vscMockExtHostedTypes.WorkspaceEdit;
mockedVSCode.RelativePattern = vscodeMocks.vscMockExtHostedTypes.RelativePattern;
mockedVSCode.ProgressLocation = vscodeMocks.vscMockExtHostedTypes.ProgressLocation;
mockedVSCode.ViewColumn = vscodeMocks.vscMockExtHostedTypes.ViewColumn;
mockedVSCode.TextEditorRevealType = vscodeMocks.vscMockExtHostedTypes.TextEditorRevealType;
mockedVSCode.TreeItem = vscodeMocks.vscMockExtHostedTypes.TreeItem;
mockedVSCode.TreeItemCollapsibleState = vscodeMocks.vscMockExtHostedTypes.TreeItemCollapsibleState;
mockedVSCode.CodeActionKind = vscodeMocks.vscMock.CodeActionKind;
mockedVSCode.CompletionItemKind = vscodeMocks.vscMock.CompletionItemKind;
mockedVSCode.CompletionTriggerKind = vscodeMocks.vscMock.CompletionTriggerKind;
mockedVSCode.DebugAdapterExecutable = vscodeMocks.vscMock.DebugAdapterExecutable;
mockedVSCode.DebugAdapterServer = vscodeMocks.vscMock.DebugAdapterServer;
mockedVSCode.QuickInputButtons = vscodeMocks.vscMockExtHostedTypes.QuickInputButtons;
mockedVSCode.FileType = vscodeMocks.vscMock.FileType;
mockedVSCode.UIKind = vscodeMocks.vscMock.UIKind;
mockedVSCode.ThemeIcon = vscodeMocks.vscMockExtHostedTypes.ThemeIcon;
mockedVSCode.ThemeColor = vscodeMocks.vscMockExtHostedTypes.ThemeColor;
mockedVSCode.FileSystemError = vscodeMocks.vscMockExtHostedTypes.FileSystemError;
mockedVSCode.FileDecoration = vscodeMocks.vscMockExtHostedTypes.FileDecoration;
mockedVSCode.PortAutoForwardAction = vscodeMocks.vscMockExtHostedTypes.PortAutoForwardAction;
mockedVSCode.PortAttributes = vscodeMocks.vscMockExtHostedTypes.PortAttributes;
mockedVSCode.NotebookRendererScript = vscodeMocks.vscMockExtHostedTypes.NotebookRendererScript;
mockedVSCode.NotebookEdit = vscodeMocks.vscMockExtHostedTypes.NotebookEdit;
mockedVSCode.NotebookRange = vscodeMocks.vscMockExtHostedTypes.NotebookRange;
mockedVSCode.QuickPickItemKind = vscodeMocks.vscMockExtHostedTypes.QuickPickItemKind;
(mockedVSCode as any).NotebookCellKind = vscodeMocks.vscMockExtHostedTypes.NotebookCellKind;
(mockedVSCode as any).NotebookRunState = vscodeMocks.vscMockExtHostedTypes.NotebookRunState;
(mockedVSCode as any).NotebookCellRunState = vscodeMocks.vscMockExtHostedTypes.NotebookCellRunState;
(mockedVSCode as any).NotebookControllerAffinity = vscodeMocks.vscMockExtHostedTypes.NotebookControllerAffinity;
(mockedVSCode as any).NotebookCellMetadata = vscodeMocks.vscMockExtHostedTypes.NotebookCellMetadata;
(mockedVSCode as any).NotebookCellMetadata = vscodeMocks.vscMockExtHostedTypes.NotebookCellMetadata;
(mockedVSCode as any).NotebookCellOutput = vscodeMocks.vscMockExtHostedTypes.NotebookCellOutput;
(mockedVSCode as any).NotebookCellOutputItem = vscodeMocks.vscMockExtHostedTypes.NotebookCellOutputItem;
(mockedVSCode as any).NotebookCellExecutionState = vscodeMocks.vscMockExtHostedTypes.NotebookCellExecutionState;
(mockedVSCode as any).notebook = { notebookDocuments: [] };
mockedVSCode.workspace;
// This API is used in src/telemetry/telemetry.ts
const extensions = mock<typeof vscode.extensions>();
when(extensions.all).thenReturn([]);
const extension = mock<vscode.Extension<any>>();
const packageJson = mock<any>();
const contributes = mock<any>();
when(extension.packageJSON).thenReturn(instance(packageJson));
when(packageJson.contributes).thenReturn(instance(contributes));
when(contributes.debuggers).thenReturn([{ aiKey: '' }]);
when(extensions.getExtension(anything())).thenReturn(instance(extension));
mockedVSCode.extensions = instance(extensions);
