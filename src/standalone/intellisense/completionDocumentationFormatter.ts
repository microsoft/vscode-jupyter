// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MarkdownString } from 'vscode';
import { splitLines } from '../../platform/common/helpers';

const formatters = new Map<string, (documentation: string) => MarkdownString | string>([
    ['julia', convertJuliaDocumentationToMarkdown],
    ['python', convertPythonDocumentationToMarkdown],
    ['r', convertRDocumentationToMarkdown]
]);

export function convertDocumentationToMarkdown(documentation: string, language: string): MarkdownString | string {
    const formatter = formatters.get(language.toLowerCase());
    return formatter ? formatter(documentation) : documentation;
}

const sectionHeaders = [
    'Docstring:',
    'Options:',
    'Parameters',
    'Returns',
    'See Also',
    'Notes',
    'Examples',
    'Usage:',
    'Subclasses:'
];
function convertPythonDocumentationToMarkdown(documentation: string): MarkdownString | string {
    const lines = splitLines(documentation, { trim: false, removeEmptyEntries: false });
    let lastHeaderIndex = -1;
    let codeBlockStarted = false;
    let foundStringFrom = false;
    const markdownStringLines: string[] = [];
    const processedSections = new Set<string>();
    let headersStarted = false;
    let currentSection = '';
    let hasNonEmptyContent = false;
    let startedCodeBlockInTheMiddle = false;
    lines.map((line, index) => {
        if (index === 0) {
            const signature = ['Signature:', 'Init signature:'].find((signature) =>
                line.toLowerCase().startsWith(signature.toLowerCase())
            );
            if (signature) {
                codeBlockStarted = true;
                line = line.substring(signature.length).trim();
                markdownStringLines.push('```python');
                if (line.trim().length) {
                    // Code block starts in the next line.
                    // E.g df.align
                    markdownStringLines.push(line);
                    hasNonEmptyContent = true;
                }
                return;
            }
        }
        // If last line contains `File:...`, then remove that.
        if (line.startsWith('File:') && index === lines.length - 1) {
            return;
        }
        // If the first line is a the type (whether its a method, property or module) then remove that
        if (line.startsWith('Type:') && index === 0) {
            return;
        }

        // This text is not required
        if (!headersStarted && line.toLowerCase().startsWith('String form:'.toLowerCase())) {
            foundStringFrom = true;
            return;
        }
        const possibleSection = sectionHeaders.find((section) =>
            line.trim().toLowerCase().startsWith(section.toLowerCase())
        );
        if (possibleSection && !processedSections.has(possibleSection)) {
            currentSection = possibleSection.toLowerCase();
            processedSections.add(possibleSection);
            headersStarted = true;
            lastHeaderIndex = index;
            foundStringFrom = false;

            if (codeBlockStarted) {
                // From `Signature` to `Docstring` is a code block.
                // Sometimes signatures can be multiline.
                // E.g. df.align
                markdownStringLines.push('```', '----------');
            }
            codeBlockStarted = false;
            startedCodeBlockInTheMiddle = false;

            // Sometimes docstrings are single line,
            markdownStringLines.push(`## ${possibleSection}`);
            // docstrings that are empty contain `<no docstring>` (e.g. matplotlib_inline)
            const docStringContents = line.includes(':') ? line.split(':')[1].replace('<no docstring>', '').trim() : '';
            if (docStringContents.length) {
                markdownStringLines.push(docStringContents);
                hasNonEmptyContent = true;
            }
            return;
        }
        if (foundStringFrom) {
            return;
        }
        // Remove lines that contain separators like `--------` or `::`
        // Or docstrings that are empty contain `<no docstring>`
        if (
            lastHeaderIndex + 1 === index &&
            line.replace(/-/g, '').replace(/:/g, '').replace('<no docstring>', '').trim().length === 0
        ) {
            // Possible next line is also empty or has similar characters.
            lastHeaderIndex = index;
            foundStringFrom = false;
            codeBlockStarted = false;
            startedCodeBlockInTheMiddle = false;
            return;
        }
        if (currentSection === 'parameters' || currentSection === 'see also') {
            // Every line that is not indented is a parameter entry.
            // hence those can be setup as bullet points.
            // the format of the line is `<param> : <types...>`
            const isAParamLine =
                line.trim().length && line.includes(':') && line.substring(0, 1) === line.trim().substring(0, 1);
            if (isAParamLine) {
                markdownStringLines.push(`* ${line}`);
            } else {
                markdownStringLines.push(line);
            }
            hasNonEmptyContent = hasNonEmptyContent || line.trim().length > 0;
            return;
        }
        if (currentSection === 'options:') {
            // Every line that starts with '-'
            // E.g. %%timeit
            const isOption =
                line.startsWith('-') &&
                line.trim().length &&
                line.includes(':') &&
                line.substring(0, 1) === line.trim().substring(0, 1);
            if (isOption) {
                markdownStringLines.push(`* ${line}`);
            } else {
                markdownStringLines.push(line);
            }
            hasNonEmptyContent = hasNonEmptyContent || line.trim().length > 0;
            return;
        }
        if (currentSection === 'returns') {
            // Every line that is not indented is a return type.
            // hence those can be setup as bullet points.
            const isReturnType = line.trim().length && line.substring(0, 1) === line.trim().substring(0, 1);
            if (isReturnType) {
                markdownStringLines.push(`* ${line}`);
            } else {
                markdownStringLines.push(line);
            }
            hasNonEmptyContent = hasNonEmptyContent || line.trim().length > 0;
            return;
        }
        if (
            currentSection === 'examples' &&
            !codeBlockStarted &&
            (lastHeaderIndex + 1 === index || lastHeaderIndex + 2 === index)
        ) {
            foundStringFrom = false;
            codeBlockStarted = true;
            hasNonEmptyContent = hasNonEmptyContent || line.trim().length > 0;
            return markdownStringLines.push('```python', line);
        }

        // Sometimes we have code block in the middle of the docstring.
        if (!codeBlockStarted && line.startsWith('class ') && line.trim().endsWith('):')) {
            codeBlockStarted = true;
            startedCodeBlockInTheMiddle = true;
            markdownStringLines.push('```python', line);
            hasNonEmptyContent = hasNonEmptyContent || line.trim().length > 0;
            return;
        }
        if (
            codeBlockStarted &&
            startedCodeBlockInTheMiddle &&
            line.trim().length > 0 &&
            line.substring(0, 1) !== ' ' &&
            line.substring(0, 1) !== '\t'
        ) {
            codeBlockStarted = false;
            startedCodeBlockInTheMiddle = false;
            return markdownStringLines.push(line, '```');
        }
        hasNonEmptyContent = hasNonEmptyContent || line.trim().length > 0;
        markdownStringLines.push(line);
    });

    // If there is no content, return an empty string
    // E.g. `import matplotlib_inline`
    if (!hasNonEmptyContent) {
        return '';
    }

    const markdownString = markdownStringLines.join('  \n');

    return codeBlockStarted ? new MarkdownString(markdownString + '  \n```') : new MarkdownString(markdownString);
}

const juliaSectionHeaders = [
    { section: 'Examples:', header: 'Examples', nextLine: /≡/g },
    { section: 'Usage note', header: 'Usage note', nextLine: /≡/g },
    { section: 'Note:', header: '│ Note', nextLine: '│' },
    { section: 'Note:', header: '│ Note', nextLine: String.fromCharCode(9474) }
];
function convertJuliaDocumentationToMarkdown(documentation: string): MarkdownString | string {
    const lines = splitLines(documentation, { trim: false, removeEmptyEntries: false });
    let codeBlockStarted = false;
    const markdownStringLines: string[] = [];
    const processedSections = new Set<string>();
    let currentSection = '';
    let foundNonEmptyCode = false;
    let signatureFound = false;
    // For some reason all lines start with 2 empty spaces, if thats true, strip them.
    if (lines.every((line) => line.trim().length === 0 || line.startsWith('  '))) {
        lines.forEach((line, index) => (lines[index] = line.trim().length ? line.substring(2) : line));
    }
    lines.map((line, index) => {
        if (line.trim() === '────────────────────────────────────────────────────────────────────────────') {
            // Start of an overload
            signatureFound = false;
            return markdownStringLines.push(line);
        }
        // First line is always the code.
        // Or first line after a new signature starts
        if (!signatureFound) {
            currentSection = 'signature';
            codeBlockStarted = true;
            signatureFound = true;
            if (line.trim().length) {
                foundNonEmptyCode = true;
                return markdownStringLines.push('```julia', line);
            } else {
                return markdownStringLines.push('```julia');
            }
        }
        if (currentSection === 'signature') {
            if (line.trim() === '') {
                // End of the signature
                currentSection = '';
                codeBlockStarted = false;
                foundNonEmptyCode = false;
                // End the previous code block
                markdownStringLines.push('```');
            }
        }
        const possibleSection = juliaSectionHeaders.find((section) =>
            line.trim().toLowerCase().startsWith(section.header.toLowerCase())
        );
        if (
            possibleSection &&
            (typeof possibleSection.nextLine === 'string'
                ? lines[index + 1].trim() === possibleSection.nextLine.trim()
                : lines[index + 1].trim().replace(possibleSection.nextLine, '').length === 0)
        ) {
            lines[index + 1] = ''; // Ignore the next line
            currentSection = possibleSection.section.toLowerCase();
            processedSections.add(possibleSection.header);

            if (codeBlockStarted) {
                // End the previous code block
                markdownStringLines.push('```');
            }
            codeBlockStarted = false;

            markdownStringLines.push(`## ${possibleSection.section}`);
            if (
                currentSection === 'note:' &&
                !lines
                    .slice(index + 1)
                    .every(
                        (l) =>
                            l.trim().length === 0 ||
                            l.trim().startsWith('|') ||
                            l.trim().startsWith(String.fromCharCode(9474))
                    )
            ) {
                currentSection = '';
            }
            return;
        }
        if (currentSection === 'examples:' && !codeBlockStarted) {
            codeBlockStarted = true;
            if (line.trim().length) {
                foundNonEmptyCode = true;
                return markdownStringLines.push('```julia', line);
            } else {
                return markdownStringLines.push('```julia');
            }
        }
        if (currentSection === 'note:') {
            markdownStringLines.push(line.trim() ? line.trim().substring(1) : '');
            return;
        }
        if (codeBlockStarted && !foundNonEmptyCode && line.trim().length === 0) {
            return;
        }
        markdownStringLines.push(line);
    });

    const markdownString = markdownStringLines.join('  \n');
    return codeBlockStarted ? new MarkdownString(markdownString + '  \n```') : new MarkdownString(markdownString);
}

function convertRDocumentationToMarkdown(documentation: string): MarkdownString | string {
    const lines = splitLines(documentation, { trim: false, removeEmptyEntries: false });
    const markdownStringLines: string[] = [];
    // For some reason all the text in R is indented with `     `
    // Remove that
    lines.forEach((line, index) => (lines[index] = line.indexOf('     ') === 0 ? line.substring(5) : line));
    let currentSection = '';
    let codeBlockStarted = false;
    let foundNonEmptyCode = false;
    lines.map((line) => {
        // For some reason R docstrings have a lot of `_` in them.
        // Thats great, we can use that to identify sections.

        // All headings are of the form `_S_o_r_t_i_n_g _o_r _O_r_d_e_r_i_n_g _V_e_c_t_o_r_s`
        const possibleSection = line.replace(/_/g, '').trim();
        const isSection =
            line.startsWith('_') &&
            line.includes(String.fromCharCode(8)) &&
            // Same number of `_` & ``
            line.split('_').length === line.split(String.fromCharCode(8)).length;

        if (isSection && possibleSection) {
            if (codeBlockStarted) {
                // End the previous code block
                markdownStringLines.push('```');
            }
            codeBlockStarted = false;
            currentSection = possibleSection.trim().toLowerCase();
            markdownStringLines.push(`## ${possibleSection}`);
            return;
        }
        if (
            (currentSection === 'examples' ||
                currentSection === 'examples:' ||
                currentSection === 'usage' ||
                currentSection === 'usage:') &&
            !codeBlockStarted
        ) {
            codeBlockStarted = true;
            if (line.trim().length) {
                foundNonEmptyCode = true;
                return markdownStringLines.push('```r', line);
            } else {
                return markdownStringLines.push('```r');
            }
        }
        if (currentSection === 'note:') {
            markdownStringLines.push(line.trim() ? line.trim().substring(1) : '');
            return;
        }
        if (codeBlockStarted && !foundNonEmptyCode && line.trim().length === 0) {
            return;
        }

        markdownStringLines.push(line);
    });

    const markdownString = markdownStringLines.join('  \n');
    return codeBlockStarted ? new MarkdownString(markdownString + '  \n```') : new MarkdownString(markdownString);
}
