// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../common/constants';
import '../common/extensions';

import { IJupyterSettings } from '../common/types';
import { noop } from '../common/utils/misc';
import { RegExpValues } from './constants';

export class CellMatcher {
    public codeExecRegEx: RegExp;
    public markdownExecRegEx: RegExp;

    private codeMatchRegEx: RegExp;
    private markdownMatchRegEx: RegExp;
    private defaultCellMarker: string;
    private defaultCellMarkerExec: RegExp;

    constructor(language: string | undefined, settings?: IJupyterSettings) {
        if (!language) {
            language = PYTHON_LANGUAGE;
        }

        const codeLens = settings?.codeLensExpressions.find((v) => v.language === language);
        const defaultCellMarker =
            language == MARKDOWN_LANGUAGE ? RegExpValues.MarkdownCellMarker : RegExpValues.PythonCellMarker;
        const defaultMarkdownMarker =
            language == MARKDOWN_LANGUAGE
                ? RegExpValues.MarkdownMarkdownCellMarker
                : RegExpValues.PythonMarkdownCellMarker;

        this.codeMatchRegEx = this.createRegExp(codeLens ? codeLens.codeExpression : undefined, defaultCellMarker);
        this.markdownMatchRegEx = this.createRegExp(
            codeLens ? codeLens.markdownExpression : undefined,
            defaultMarkdownMarker
        );
        this.codeExecRegEx = new RegExp(`${this.codeMatchRegEx.source}(.*)`);
        this.markdownExecRegEx = new RegExp(`${this.markdownMatchRegEx.source}(.*)`);
        this.defaultCellMarker = codeLens?.defaultCellMarker ? codeLens.defaultCellMarker : '# %%';
        this.defaultCellMarkerExec = this.createRegExp(`${this.defaultCellMarker}(.*)`, /# %%(.*)/);
    }

    public isCell(code: string): boolean {
        return this.isCode(code) || this.isMarkdown(code);
    }

    public isMarkdown(code: string): boolean {
        return !this.codeMatchRegEx.test(code) && this.markdownMatchRegEx.test(code);
    }

    public isCode(code: string): boolean {
        return this.codeMatchRegEx.test(code) || code.trim() === this.defaultCellMarker;
    }

    public getCellType(code: string): string {
        return this.isCode(code) ? 'code' : 'markdown';
    }

    public stripFirstMarker(code: string): string {
        const lines = code.splitLines({ trim: false, removeEmptyEntries: false });

        // Only strip this off the first line. Otherwise we want the markers in the code.
        if (lines.length > 0 && (this.isCode(lines[0]) || this.isMarkdown(lines[0]))) {
            return lines.slice(1).join('\n');
        }
        return code;
    }

    public exec(code: string): string | undefined {
        let result: RegExpExecArray | null = null;
        if (this.defaultCellMarkerExec.test(code)) {
            this.defaultCellMarkerExec.lastIndex = -1;
            result = this.defaultCellMarkerExec.exec(code);
        } else if (this.codeMatchRegEx.test(code)) {
            this.codeExecRegEx.lastIndex = -1;
            result = this.codeExecRegEx.exec(code);
        } else if (this.markdownMatchRegEx.test(code)) {
            this.markdownExecRegEx.lastIndex = -1;
            result = this.markdownExecRegEx.exec(code);
        }
        if (result) {
            return result.length > 1 ? result[result.length - 1].trim() : '';
        }
        return undefined;
    }

    private createRegExp(potential: string | undefined, backup: RegExp): RegExp {
        try {
            if (potential) {
                return new RegExp(potential);
            }
        } catch {
            noop();
        }

        return backup;
    }
}
