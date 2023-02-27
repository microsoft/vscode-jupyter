// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RegExpValues } from '../../platform/common/constants';
import '../../platform/common/extensions';
import { splitLines } from '../../platform/common/helpers';
import { IJupyterSettings } from '../../platform/common/types';

import { noop } from '../../platform/common/utils/misc';

/**
 * CellMatcher is used to match either markdown or code cells using the regex's provided in the settings.
 */
export class CellMatcher {
    public codeExecRegEx: RegExp;
    public markdownExecRegEx: RegExp;

    private codeMatchRegEx: RegExp;
    private markdownMatchRegEx: RegExp;
    private defaultCellMarker: string;

    constructor(settings?: IJupyterSettings) {
        this.codeMatchRegEx = this.createRegExp(
            settings ? settings.codeRegularExpression : undefined,
            RegExpValues.PythonCellMarker
        );
        this.markdownMatchRegEx = this.createRegExp(
            settings ? settings.markdownRegularExpression : undefined,
            RegExpValues.PythonMarkdownCellMarker
        );
        this.codeExecRegEx = new RegExp(`${this.codeMatchRegEx.source}(.*)`);
        this.markdownExecRegEx = new RegExp(`${this.markdownMatchRegEx.source}(.*)`);
        this.defaultCellMarker = settings?.defaultCellMarker ? settings.defaultCellMarker : '# %%';
    }

    public isCell(code: string): boolean {
        return this.isCode(code) || this.isMarkdown(code);
    }

    public isMarkdown(code: string): boolean {
        return this.markdownMatchRegEx.test(code.trim());
    }

    public isCode(code: string): boolean {
        return this.codeMatchRegEx.test(code.trim()) || code.trim() === this.defaultCellMarker;
    }

    public getCellType(code: string): string {
        return this.isMarkdown(code) ? 'markdown' : 'code';
    }

    public isEmptyCell(code: string): boolean {
        return this.stripFirstMarker(code).trim().length === 0;
    }

    public stripFirstMarker(code: string): string {
        const lines = splitLines(code, { trim: false, removeEmptyEntries: false });

        // Only strip this off the first line. Otherwise we want the markers in the code.
        if (lines.length > 0 && (this.isCode(lines[0]) || this.isMarkdown(lines[0]))) {
            return lines.slice(1).join('\n');
        }
        return code;
    }

    public stripFirstMarkerNoConcat(lines: string[]): string[] {
        // Only strip this off the first line. Otherwise we want the markers in the code.
        if (lines.length > 0 && (this.isCode(lines[0]) || this.isMarkdown(lines[0]))) {
            return lines.slice(1);
        }
        return lines;
    }

    public getFirstMarker(code: string): string | undefined {
        const lines = splitLines(code, { trim: false, removeEmptyEntries: false });

        if (lines.length > 0 && (this.isCode(lines[0]) || this.isMarkdown(lines[0]))) {
            return lines[0];
        }
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
