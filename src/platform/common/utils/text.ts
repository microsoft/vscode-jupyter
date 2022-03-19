// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Position, Range } from 'vscode';
import { isNumber } from './sysTypes';

/**
 * Return the range represented by the given string.
 *
 * If a number is provided then it is used as both lines and the
 * character are set to 0.
 *
 * Examples:
 *  '1:5-3:5' -> Range(1, 5, 3, 5)
 *  '1-3'     -> Range(1, 0, 3, 0)
 *  '1:3-1:5' -> Range(1, 3, 1, 5)
 *  '1-1'     -> Range(1, 0, 1, 0)
 *  '1'       -> Range(1, 0, 1, 0)
 *  '1:3-'    -> Range(1, 3, 1, 0)
 *  '1:3'     -> Range(1, 3, 1, 0)
 *  ''        -> Range(0, 0, 0, 0)
 *  '3-1'     -> Range(1, 0, 3, 0)
 */
export function parseRange(raw: string | number): Range {
    if (isNumber(raw)) {
        return new Range(raw, 0, raw, 0);
    }
    if (raw === '') {
        return new Range(0, 0, 0, 0);
    }

    const parts = raw.split('-');
    if (parts.length > 2) {
        throw new Error(`invalid range ${raw}`);
    }

    const start = parsePosition(parts[0]);
    let end = start;
    if (parts.length === 2) {
        end = parsePosition(parts[1]);
    }
    return new Range(start, end);
}

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
