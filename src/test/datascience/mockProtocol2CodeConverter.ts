// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as code from 'vscode';
// eslint-disable-next-line
import ProtocolCompletionItem from 'vscode-languageclient/lib/common/protocolCompletionItem';
import { Protocol2CodeConverter } from 'vscode-languageclient/node';
import * as proto from 'vscode-languageserver-protocol';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/unified-signatures */
export class MockProtocol2CodeConverter implements Protocol2CodeConverter {
    public asUri(_value: string): code.Uri {
        throw new Error('Method not implemented.');
    }

    public asDiagnostic(_diagnostic: proto.Diagnostic): code.Diagnostic {
        throw new Error('Method not implemented.');
    }
    public asDiagnostics(
        _diagnostics: proto.Diagnostic[],
        _token?: code.CancellationToken
    ): Promise<code.Diagnostic[]> {
        throw new Error('Method not implemented.');
    }

    public asPosition(value: proto.Position): code.Position;
    public asPosition(value: undefined): undefined;
    public asPosition(value: null): null;
    public asPosition(value: proto.Position | null | undefined): code.Position | null | undefined;
    public asPosition(value: any): any {
        if (!value) {
            return undefined;
        }
        return new code.Position(value.line, value.character);
    }
    public asRange(value: proto.Range): code.Range;
    public asRange(value: undefined): undefined;
    public asRange(value: null): null;
    public asRange(value: proto.Range | null | undefined): code.Range | null | undefined;
    public asRange(value: any): any {
        if (!value) {
            return undefined;
        }
        return new code.Range(
            this.asPosition(value.start as proto.Position),
            this.asPosition(value.end as proto.Position)
        );
    }
    public asDiagnosticSeverity(_value: number | null | undefined): code.DiagnosticSeverity {
        throw new Error('Method not implemented.');
    }
    public asHover(hover: proto.Hover): code.Hover;
    public asHover(hover: null | undefined): undefined;
    public asHover(hover: proto.Hover | null | undefined): code.Hover | undefined;
    public asHover(hover: any): any {
        if (!hover) {
            return undefined;
        }
        return hover;
    }
    public asCompletionResult(
        value: undefined | null,
        allCommitCharacters?: string[],
        token?: code.CancellationToken
    ): Promise<undefined>;
    public asCompletionResult(
        value: proto.CompletionList,
        allCommitCharacters?: string[],
        token?: code.CancellationToken
    ): Promise<code.CompletionList>;
    public asCompletionResult(
        value: proto.CompletionItem[],
        allCommitCharacters?: string[],
        token?: code.CancellationToken
    ): Promise<code.CompletionItem[]>;
    public asCompletionResult(
        value: proto.CompletionItem[] | proto.CompletionList | undefined | null,
        allCommitCharacters?: string[],
        token?: code.CancellationToken
    ): Promise<code.CompletionItem[] | code.CompletionList | undefined>;
    public asCompletionResult(result: any): Promise<any> {
        if (!result) {
            return Promise.resolve(undefined);
        }
        if (Array.isArray(result)) {
            const items = <proto.CompletionItem[]>result;
            return Promise.resolve(items.map(this.asCompletionItem.bind(this)));
        }
        const list = <proto.CompletionList>result;
        return Promise.resolve(
            new code.CompletionList(list.items.map(this.asCompletionItem.bind(this)), list.isIncomplete)
        );
    }
    public asCompletionItem(item: proto.CompletionItem): ProtocolCompletionItem {
        const result = new ProtocolCompletionItem(item.label);
        if (item.detail) {
            result.detail = item.detail;
        }
        if (item.documentation) {
            result.documentation = item.documentation.toString();
            result.documentationFormat = '$string';
        }
        if (item.filterText) {
            result.filterText = item.filterText;
        }
        const insertText = this.asCompletionInsertText(item);
        if (insertText) {
            result.insertText = insertText.text;
            result.range = insertText.range;
            result.fromEdit = insertText.fromEdit;
        }
        if (typeof item.kind === 'number') {
            const [itemKind, original] = this.asCompletionItemKind(item.kind);
            result.kind = itemKind;
            if (original) {
                result.originalItemKind = original;
            }
        }
        if (item.sortText) {
            result.sortText = item.sortText;
        }
        if (item.additionalTextEdits) {
            result.additionalTextEdits = this.asCodeTextEdits(item.additionalTextEdits);
        }
        if (this.isStringArray(item.commitCharacters)) {
            result.commitCharacters = item.commitCharacters.slice();
        }
        if (item.command) {
            result.command = this.asCommand(item.command);
        }
        if (item.deprecated === true || item.deprecated === false) {
            result.deprecated = item.deprecated;
        }
        if (item.preselect === true || item.preselect === false) {
            result.preselect = item.preselect;
        }
        if (item.data !== undefined) {
            result.data = item.data;
        }
        return result;
    }
    public asTextEdit(edit: null | undefined): undefined;
    public asTextEdit(edit: proto.TextEdit): code.TextEdit;
    public asTextEdit(edit: proto.TextEdit | null | undefined): code.TextEdit | undefined;
    public asTextEdit(_edit: any): any {
        throw new Error('Method not implemented.');
    }
    public asTextEdits(items: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asTextEdits(items: proto.TextEdit[], token?: code.CancellationToken): Promise<code.TextEdit[]>;
    public asTextEdits(
        items: proto.TextEdit[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.TextEdit[] | undefined>;
    public asTextEdits(_items: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asSignatureHelp(item: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asSignatureHelp(item: proto.SignatureHelp, token?: code.CancellationToken): Promise<code.SignatureHelp>;
    public asSignatureHelp(
        item: proto.SignatureHelp | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.SignatureHelp | undefined>;
    public asSignatureHelp(_item: any): Promise<any> {
        throw new Error('Method not implemented.');
    }

    public asSignatureInformation(
        _item: proto.SignatureInformation,
        _token?: code.CancellationToken
    ): Promise<code.SignatureInformation> {
        throw new Error('Method not implemented.');
    }

    public asSignatureInformations(
        _items: proto.SignatureInformation[],
        _token?: code.CancellationToken
    ): Promise<code.SignatureInformation[]> {
        throw new Error('Method not implemented.');
    }

    public asParameterInformation(_item: proto.ParameterInformation): code.ParameterInformation {
        throw new Error('Method not implemented.');
    }

    public asParameterInformations(
        _item: proto.ParameterInformation[],
        _token?: code.CancellationToken
    ): Promise<code.ParameterInformation[]> {
        throw new Error('Method not implemented.');
    }

    public asLocation(item: proto.Location): code.Location;
    public asLocation(item: null | undefined): undefined;
    public asLocation(item: proto.Location | null | undefined): code.Location | undefined;
    public asLocation(_item: any): any {
        throw new Error('Method not implemented.');
    }
    public asDeclarationResult(item: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asDeclarationResult(
        item: proto.Declaration,
        token?: code.CancellationToken
    ): Promise<code.Location | code.Location[]>;
    public asDeclarationResult(
        item: proto.DeclarationLink[],
        token?: code.CancellationToken
    ): Promise<code.LocationLink[]>;
    public asDeclarationResult(
        item: proto.Declaration | proto.DeclarationLink[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.Declaration | undefined>;
    public asDeclarationResult(_item: any): Promise<any> {
        throw new Error('Method not implemented.');
    }

    public asDefinitionResult(item: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asDefinitionResult(item: proto.Definition, token?: code.CancellationToken): Promise<code.Definition>;
    public asDefinitionResult(
        item: proto.DefinitionLink[],
        token?: code.CancellationToken
    ): Promise<code.DefinitionLink[]>;
    public asDefinitionResult(
        item: proto.Definition | proto.DefinitionLink[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.Definition | code.DefinitionLink[] | undefined>;
    public asDefinitionResult(_item: any): Promise<any> {
        throw new Error('Method not implemented.');
    }

    public asReferences(values: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asReferences(values: proto.Location[], token?: code.CancellationToken): Promise<code.Location[]>;
    public asReferences(
        values: proto.Location[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.Location[] | undefined>;
    public asReferences(_values: any): Promise<any> {
        throw new Error('Method not implemented.');
    }

    public asDocumentHighlightKind(_item: number): code.DocumentHighlightKind {
        throw new Error('Method not implemented.');
    }
    public asDocumentHighlight(_item: proto.DocumentHighlight): code.DocumentHighlight {
        throw new Error('Method not implemented.');
    }

    public asDocumentHighlights(values: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asDocumentHighlights(
        values: proto.DocumentHighlight[],
        token?: code.CancellationToken
    ): Promise<code.DocumentHighlight[]>;
    public asDocumentHighlights(
        values: proto.DocumentHighlight[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.DocumentHighlight[] | undefined>;
    public asDocumentHighlights(_values: any): any {
        throw new Error('Method not implemented.');
    }
    public asSymbolInformation(_item: proto.SymbolInformation, _uri?: code.Uri | undefined): code.SymbolInformation {
        throw new Error('Method not implemented.');
    }

    public asSymbolInformations(values: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asSymbolInformations(
        values: proto.SymbolInformation[] | proto.WorkspaceSymbol[],
        token?: code.CancellationToken
    ): Promise<code.SymbolInformation[]>;
    public asSymbolInformations(
        values: proto.SymbolInformation[] | proto.WorkspaceSymbol[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.SymbolInformation[] | undefined>;
    public asSymbolInformations(_values: any, _uri?: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asDocumentSymbol(_value: proto.DocumentSymbol): code.DocumentSymbol {
        throw new Error('Method not implemented.');
    }

    public asDocumentSymbols(value: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asDocumentSymbols(
        value: proto.DocumentSymbol[],
        token?: code.CancellationToken
    ): Promise<code.DocumentSymbol[]>;
    public asDocumentSymbols(
        value: proto.DocumentSymbol[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.DocumentSymbol[] | undefined>;
    public asDocumentSymbols(_value: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asCommand(_item: proto.Command): code.Command {
        throw new Error('Method not implemented.');
    }
    public asCommands(items: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asCommands(items: proto.Command[], token?: code.CancellationToken): Promise<code.Command[]>;
    public asCommands(
        items: proto.Command[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.Command[] | undefined>;
    public asCommands(_items: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asCodeAction(item: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asCodeAction(item: proto.CodeAction, token?: code.CancellationToken): Promise<code.CodeAction>;
    public asCodeAction(
        item: proto.CodeAction | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.CodeAction | undefined>;
    public asCodeAction(_item: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asCodeActionKind(item: null | undefined): undefined;
    public asCodeActionKind(item: string): code.CodeActionKind;
    public asCodeActionKind(item: string | null | undefined): code.CodeActionKind | undefined;
    public asCodeActionKind(_item: any): any {
        throw new Error('Method not implemented.');
    }
    public asCodeActionKinds(item: null | undefined): undefined;
    public asCodeActionKinds(items: string[]): code.CodeActionKind[];
    public asCodeActionKinds(item: string[] | null | undefined): code.CodeActionKind[] | undefined;
    public asCodeActionKinds(_item: any): any {
        throw new Error('Method not implemented.');
    }
    public asCodeLens(item: proto.CodeLens): code.CodeLens;
    public asCodeLens(item: null | undefined): undefined;
    public asCodeLens(item: proto.CodeLens | null | undefined): code.CodeLens | undefined;
    public asCodeLens(_item: any): any {
        throw new Error('Method not implemented.');
    }
    public asCodeLenses(items: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asCodeLenses(items: proto.CodeLens[], token?: code.CancellationToken): Promise<code.CodeLens[]>;
    public asCodeLenses(
        items: proto.CodeLens[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.CodeLens[] | undefined>;
    public asCodeLenses(_items: any): Promise<any> {
        throw new Error('Method not implemented.');
    }

    public asWorkspaceEdit(item: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asWorkspaceEdit(item: proto.WorkspaceEdit, token?: code.CancellationToken): Promise<code.WorkspaceEdit>;
    public asWorkspaceEdit(
        item: proto.WorkspaceEdit | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.WorkspaceEdit | undefined>;
    public asWorkspaceEdit(_item: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asDocumentLink(_item: proto.DocumentLink): code.DocumentLink {
        throw new Error('Method not implemented.');
    }
    public asDocumentLinks(items: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asDocumentLinks(items: proto.DocumentLink[], token?: code.CancellationToken): Promise<code.DocumentLink[]>;
    public asDocumentLinks(
        items: proto.DocumentLink[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.DocumentLink[] | undefined>;
    public asDocumentLinks(_items: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asColor(_color: proto.Color): code.Color {
        throw new Error('Method not implemented.');
    }
    public asColorInformation(_ci: proto.ColorInformation): code.ColorInformation {
        throw new Error('Method not implemented.');
    }
    public asColorInformations(
        colorPresentations: undefined | null,
        token?: code.CancellationToken
    ): Promise<undefined>;
    public asColorInformations(
        colorPresentations: proto.ColorInformation[],
        token?: code.CancellationToken
    ): Promise<code.ColorInformation[]>;
    public asColorInformations(
        colorInformation: proto.ColorInformation[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.ColorInformation[]>;
    public asColorInformations(_colorInformation: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asColorPresentation(_cp: proto.ColorPresentation): code.ColorPresentation {
        throw new Error('Method not implemented.');
    }
    public asColorPresentations(
        colorPresentations: undefined | null,
        token?: code.CancellationToken
    ): Promise<undefined>;
    public asColorPresentations(
        colorPresentations: proto.ColorPresentation[],
        token?: code.CancellationToken
    ): Promise<code.ColorPresentation[]>;
    public asColorPresentations(
        colorPresentations: proto.ColorPresentation[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.ColorPresentation[] | undefined>;
    public asColorPresentations(_colorPresentations: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asFoldingRangeKind(_kind: string | undefined): code.FoldingRangeKind | undefined {
        throw new Error('Method not implemented.');
    }
    public asFoldingRange(_r: proto.FoldingRange): code.FoldingRange {
        throw new Error('Method not implemented.');
    }
    public asFoldingRanges(foldingRanges: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asFoldingRanges(
        foldingRanges: proto.FoldingRange[],
        token?: code.CancellationToken
    ): Promise<code.FoldingRange[]>;
    public asFoldingRanges(
        foldingRanges: proto.FoldingRange[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.FoldingRange[] | undefined>;
    public asFoldingRanges(_foldingRanges: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asRanges(_items: ReadonlyArray<proto.Range>, _token?: code.CancellationToken): Promise<code.Range[]> {
        throw new Error('Method not implemented.');
    }
    public asDiagnosticTag(_tag: proto.InsertTextFormat): code.DiagnosticTag | undefined {
        throw new Error('Method not implemented.');
    }
    public asSymbolKind(_item: proto.SymbolKind): code.SymbolKind {
        throw new Error('Method not implemented.');
    }
    public asSymbolTag(_item: 1): code.SymbolTag {
        throw new Error('Method not implemented.');
    }
    public asSymbolTags(items: null | undefined): undefined;
    public asSymbolTags(items: readonly 1[]): code.SymbolTag[];
    public asSymbolTags(items: readonly 1[] | null | undefined): code.SymbolTag[] | undefined;
    public asSymbolTags(_items: any): any {
        throw new Error('Method not implemented.');
    }
    public asSelectionRange(_selectionRange: proto.SelectionRange): code.SelectionRange {
        throw new Error('Method not implemented.');
    }
    public asSelectionRanges(selectionRanges: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asSelectionRanges(
        selectionRanges: proto.SelectionRange[],
        token?: code.CancellationToken
    ): Promise<code.SelectionRange[]>;
    public asSelectionRanges(
        selectionRanges: proto.SelectionRange[] | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.SelectionRange[] | undefined>;
    public asSelectionRanges(_selectionRanges: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asSemanticTokensLegend(_value: proto.SemanticTokensLegend): code.SemanticTokensLegend {
        throw new Error('Method not implemented.');
    }

    public asSemanticTokens(value: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asSemanticTokens(value: proto.SemanticTokens, token?: code.CancellationToken): Promise<code.SemanticTokens>;
    public asSemanticTokens(
        value: proto.SemanticTokens | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.SemanticTokens | undefined>;
    public asSemanticTokens(_value: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asSemanticTokensEdit(_value: proto.SemanticTokensEdit): code.SemanticTokensEdit {
        throw new Error('Method not implemented.');
    }
    public asSemanticTokensEdits(value: undefined | null, token?: code.CancellationToken): Promise<undefined>;
    public asSemanticTokensEdits(
        value: proto.SemanticTokensDelta,
        token?: code.CancellationToken
    ): Promise<code.SemanticTokensEdits>;
    public asSemanticTokensEdits(
        value: proto.SemanticTokensDelta | undefined | null,
        token?: code.CancellationToken
    ): Promise<code.SemanticTokensEdits | undefined>;
    public asSemanticTokensEdits(_value: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asCallHierarchyItem(item: null): undefined;
    public asCallHierarchyItem(item: proto.CallHierarchyItem): code.CallHierarchyItem;
    public asCallHierarchyItem(item: proto.CallHierarchyItem | null): code.CallHierarchyItem | undefined;
    public asCallHierarchyItem(item: proto.CallHierarchyItem | null): code.CallHierarchyItem | undefined;
    public asCallHierarchyItem(_item: any): code.CallHierarchyItem | undefined {
        throw new Error('Method not implemented.');
    }
    public asCallHierarchyItems(items: null, token?: code.CancellationToken): Promise<undefined>;
    public asCallHierarchyItems(
        items: proto.CallHierarchyItem[],
        token?: code.CancellationToken
    ): Promise<code.CallHierarchyItem[]>;
    public asCallHierarchyItems(
        items: proto.CallHierarchyItem[] | null,
        token?: code.CancellationToken
    ): Promise<code.CallHierarchyItem[] | undefined>;
    public asCallHierarchyItems(_items: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asCallHierarchyIncomingCall(
        _item: proto.CallHierarchyIncomingCall,
        _token?: code.CancellationToken
    ): Promise<code.CallHierarchyIncomingCall> {
        throw new Error('Method not implemented.');
    }

    public asCallHierarchyIncomingCalls(items: null, token?: code.CancellationToken): Promise<undefined>;
    public asCallHierarchyIncomingCalls(
        items: ReadonlyArray<proto.CallHierarchyIncomingCall>,
        token?: code.CancellationToken
    ): Promise<code.CallHierarchyIncomingCall[]>;
    public asCallHierarchyIncomingCalls(
        items: ReadonlyArray<proto.CallHierarchyIncomingCall> | null,
        token?: code.CancellationToken
    ): Promise<code.CallHierarchyIncomingCall[] | undefined>;
    public asCallHierarchyIncomingCalls(_items: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asCallHierarchyOutgoingCall(
        _item: proto.CallHierarchyOutgoingCall,
        _token?: code.CancellationToken
    ): Promise<code.CallHierarchyOutgoingCall> {
        throw new Error('Method not implemented.');
    }

    public asCallHierarchyOutgoingCalls(items: null, token?: code.CancellationToken): Promise<undefined>;
    public asCallHierarchyOutgoingCalls(
        items: ReadonlyArray<proto.CallHierarchyOutgoingCall>,
        token?: code.CancellationToken
    ): Promise<code.CallHierarchyOutgoingCall[]>;
    public asCallHierarchyOutgoingCalls(
        items: ReadonlyArray<proto.CallHierarchyOutgoingCall> | null,
        token?: code.CancellationToken
    ): Promise<code.CallHierarchyOutgoingCall[] | undefined>;
    public asCallHierarchyOutgoingCalls(_items: any): Promise<any> {
        throw new Error('Method not implemented.');
    }

    public asLinkedEditingRanges(value: null | undefined, token?: code.CancellationToken): Promise<undefined>;
    public asLinkedEditingRanges(
        value: proto.LinkedEditingRanges,
        token?: code.CancellationToken
    ): Promise<code.LinkedEditingRanges>;
    public asLinkedEditingRanges(
        value: proto.LinkedEditingRanges | null | undefined,
        token?: code.CancellationToken
    ): Promise<code.LinkedEditingRanges | undefined>;
    public asLinkedEditingRanges(_value: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asDocumentSelector(_value: proto.DocumentSelector): code.DocumentSelector {
        throw new Error('Method not implemented.');
    }
    public asCodeActionResult(
        _items: (proto.Command | proto.CodeAction)[],
        _token?: code.CancellationToken
    ): Promise<(code.Command | code.CodeAction)[]> {
        throw new Error('Method not implemented.');
    }
    public asInlineValue(_value: proto.InlineValue): code.InlineValue {
        throw new Error('Method not implemented.');
    }
    public asInlineValues(values: null | undefined, token?: code.CancellationToken): Promise<undefined>;
    public asInlineValues(values: proto.InlineValue[], token?: code.CancellationToken): Promise<code.InlineValue[]>;
    public asInlineValues(
        values: proto.InlineValue[] | null | undefined,
        _token?: code.CancellationToken
    ): Promise<code.InlineValue[] | undefined>;
    public asInlineValues(_values: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asInlayHint(_value: proto.InlayHint, _token?: code.CancellationToken): Promise<code.InlayHint> {
        throw new Error('Method not implemented.');
    }
    public asInlayHints(values: null | undefined, token?: code.CancellationToken): Promise<undefined>;
    public asInlayHints(values: proto.InlayHint[], token?: code.CancellationToken): Promise<code.InlayHint[]>;
    public asInlayHints(
        values: proto.InlayHint[] | null | undefined,
        token?: code.CancellationToken
    ): Promise<code.InlayHint[] | undefined>;
    public asInlayHints(_values: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asTypeHierarchyItem(item: null): undefined;
    public asTypeHierarchyItem(item: proto.TypeHierarchyItem): code.TypeHierarchyItem;
    public asTypeHierarchyItem(item: proto.TypeHierarchyItem | null): code.TypeHierarchyItem | undefined;
    public asTypeHierarchyItem(_item: any): code.TypeHierarchyItem | undefined {
        throw new Error('Method not implemented.');
    }
    public asTypeHierarchyItems(items: null, token?: code.CancellationToken): Promise<undefined>;
    public asTypeHierarchyItems(
        items: proto.TypeHierarchyItem[],
        token?: code.CancellationToken
    ): Promise<code.TypeHierarchyItem[]>;
    public asTypeHierarchyItems(
        items: proto.TypeHierarchyItem[] | null,
        token?: code.CancellationToken
    ): Promise<code.TypeHierarchyItem[] | undefined>;
    public asTypeHierarchyItems(_items: any): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public asGlobPattern(_pattern: proto.GlobPattern): code.GlobPattern | undefined {
        throw new Error('Method not implemented.');
    }

    private asCodeTextEdits(additionalTextEdits: proto.TextEdit[]): code.TextEdit[] | undefined {
        return additionalTextEdits.map((e) => {
            const range = new code.Range(
                new code.Position(e.range.start.line, e.range.start.character),
                new code.Position(e.range.end.line, e.range.end.character)
            );
            return new code.TextEdit(range, e.newText);
        });
    }

    private asCompletionItemKind(
        value: proto.CompletionItemKind
    ): [code.CompletionItemKind, proto.CompletionItemKind | undefined] {
        // Protocol item kind is 1 based, codes item kind is zero based.
        if (proto.CompletionItemKind.Text <= value && value <= proto.CompletionItemKind.TypeParameter) {
            return [value - 1, undefined];
        }
        return [code.CompletionItemKind.Text, value];
    }

    private isStringArray(value: any): value is string[] {
        return Array.isArray(value) && (<any[]>value).every((elem) => typeof elem === 'string');
    }

    private asCompletionInsertText(
        item: proto.CompletionItem
    ): { text: string | code.SnippetString; range?: code.Range; fromEdit: boolean } | undefined {
        if (item.textEdit) {
            if (item.insertTextFormat === proto.InsertTextFormat.Snippet) {
                return {
                    text: new code.SnippetString(item.textEdit.newText),
                    range: this.asRange((item.textEdit as code.TextEdit).range),
                    fromEdit: true
                };
            } else {
                return {
                    text: item.textEdit.newText,
                    range: this.asRange((item.textEdit as code.TextEdit).range),
                    fromEdit: true
                };
            }
        } else if (item.insertText) {
            if (item.insertTextFormat === proto.InsertTextFormat.Snippet) {
                return { text: new code.SnippetString(item.insertText), fromEdit: false };
            } else {
                return { text: item.insertText, fromEdit: false };
            }
        } else {
            return undefined;
        }
    }
}
