// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Position } from 'vscode';
import { isNumber } from './sysTypes';

/**
 * Return the line/column represented by the given string.
 *
 * If a number is provided then it is used as the line and the character
 * is set to 0.
 *
 * Examples:
 *  '1:5' -> Position(1, 5)
 *  '1'   -> Position(1, 0)
 *  ''    -> Position(0, 0)
 */
export function parsePosition(raw: string | number): Position {
    if (isNumber(raw)) {
        return new Position(raw, 0);
    }
    if (raw === '') {
        return new Position(0, 0);
    }

    const parts = raw.split(':');
    if (parts.length > 2) {
        throw new Error(`invalid position ${raw}`);
    }

    let line = 0;
    if (parts[0] !== '') {
        if (!/^\d+$/.test(parts[0])) {
            throw new Error(`invalid position ${raw}`);
        }
        line = +parts[0];
    }
    let col = 0;
    if (parts.length === 2 && parts[1] !== '') {
        if (!/^\d+$/.test(parts[1])) {
            throw new Error(`invalid position ${raw}`);
        }
        col = +parts[1];
    }
    return new Position(line, col);
}
