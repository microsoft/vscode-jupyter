// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MarkdownString } from 'vscode';
const formatters = new Map<string, (documentation: string) => MarkdownString | string>([
    ['julia', formatAndConvertJuliaDocumentationToMarkdown],
    ['python', formatAndConvertPythonDocumentationToMarkdown]
]);

export function formatAndConvertDocumentationToMarkdown(
    documentation: string,
    language: string
): MarkdownString | string {
    const formatter = formatters.get(language.toLowerCase());
    return formatter ? formatter(documentation) : documentation;
}

export function formatAndConvertJuliaDocumentationToMarkdown(documentation: string): MarkdownString | string {
    return documentation;
}

export function formatAndConvertPythonDocumentationToMarkdown(documentation: string): MarkdownString | string {
    return documentation;
}
