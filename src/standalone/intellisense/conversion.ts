// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

// See the comment on convertCompletionItemKind below
// Here's the monaco enum:
enum monacoCompletionItemKind {
    Method = 0,
    Function = 1,
    Constructor = 2,
    Field = 3,
    Variable = 4,
    Class = 5,
    Struct = 6,
    Interface = 7,
    Module = 8,
    Property = 9,
    Event = 10,
    Operator = 11,
    Unit = 12,
    Value = 13,
    Constant = 14,
    Enum = 15,
    EnumMember = 16,
    Keyword = 17,
    Text = 18,
    Color = 19,
    File = 20,
    Reference = 21,
    Customcolor = 22,
    Folder = 23,
    TypeParameter = 24,
    Snippet = 25
}
export const mapJupyterKind: Map<string, number> = new Map<string, number>([
    ['method', monacoCompletionItemKind.Method],
    ['function', monacoCompletionItemKind.Function],
    ['constructor', monacoCompletionItemKind.Constructor],
    ['field', monacoCompletionItemKind.Field],
    ['variable', monacoCompletionItemKind.Variable],
    ['class', monacoCompletionItemKind.Class],
    ['struct', monacoCompletionItemKind.Struct],
    ['interface', monacoCompletionItemKind.Interface],
    ['module', monacoCompletionItemKind.Module],
    ['property', monacoCompletionItemKind.Property],
    ['event', monacoCompletionItemKind.Event],
    ['operator', monacoCompletionItemKind.Operator],
    ['unit', monacoCompletionItemKind.Unit],
    ['value', monacoCompletionItemKind.Value],
    ['constant', monacoCompletionItemKind.Constant],
    ['enum', monacoCompletionItemKind.Enum],
    ['enumMember', monacoCompletionItemKind.EnumMember],
    ['keyword', monacoCompletionItemKind.Keyword],
    ['text', monacoCompletionItemKind.Text],
    ['color', monacoCompletionItemKind.Color],
    ['file', monacoCompletionItemKind.File],
    ['reference', monacoCompletionItemKind.Reference],
    ['customcolor', monacoCompletionItemKind.Customcolor],
    ['folder', monacoCompletionItemKind.Folder],
    ['typeParameter', monacoCompletionItemKind.TypeParameter],
    ['snippet', monacoCompletionItemKind.Snippet],
    ['<unknown>', monacoCompletionItemKind.Field]
]);
