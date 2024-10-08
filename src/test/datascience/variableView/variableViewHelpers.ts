// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fastDeepEqual from 'fast-deep-equal';
import { parse } from 'node-html-parser';
import { assert } from 'chai';
import { waitForCondition } from '../../common';
import { defaultNotebookTestTimeout } from '../notebook/helper';
import { ITestWebviewHost } from '../testInterfaces';

// Basic shape of a variable result
export interface IVariableInfo {
    name: string;
    type: string;
    length: string;
    value?: string;
}

export async function waitForVariablesToMatch(expected: IVariableInfo[], variableView: ITestWebviewHost) {
    let htmlVariables: IVariableInfo[] | undefined;
    return waitForCondition(
        async () => {
            const htmlResult = await variableView?.getHTMLById('variable-view-main-panel');
            htmlVariables = parseVariableViewHTML(htmlResult);
            return variablesMatch(expected, htmlVariables);
        },
        defaultNotebookTestTimeout,
        // Use function here to generate message so that htmlResult is queried at end
        () => `Variables do not match. Expected ${JSON.stringify(expected)} but got ${JSON.stringify(htmlVariables)}`
    );
}

// For the given html, verify that the expected variables are in it
function variablesMatch(expected: IVariableInfo[], htmlVariables: IVariableInfo[]): boolean {
    // Check our size first
    if (htmlVariables.length != expected.length) {
        return false;
    }

    // Then check all the values
    const failures = expected
        .map((expectedInfo, index) => {
            return compareVariableInfos(expectedInfo, htmlVariables[index]);
        })
        .filter((b) => !b);
    return failures.length <= 0;
}

// Helper function to parse the view HTML
function parseVariableViewHTML(html: string): IVariableInfo[] {
    const htmlDoc = parse(html);
    const variableRows = htmlDoc
        .querySelectorAll('div')
        .filter((d) => d.classList.value.indexOf('react-grid-Row') >= 0);

    const variableInfos: IVariableInfo[] = [];
    // HTMLCollectionOf doesn't support nice iterators
    variableRows.forEach((child) => {
        const cols = child.querySelectorAll('div').filter((d) => d.rawAttrs.indexOf('role="cell"') >= 0);
        const row: IVariableInfo = {
            name: cols[0].innerHTML,
            type: cols[1].innerHTML,
            length: cols[2].innerHTML,
            value: cols[3].innerHTML
        };
        variableInfos.push(row);
    });

    return variableInfos;
}

// Compare two variable infos
function compareVariableInfos(expected: IVariableInfo, actual: IVariableInfo) {
    if (expected.value !== undefined) {
        return fastDeepEqual(expected, actual);
    } else {
        // If we don't specify an expected value, then don't check it
        // useful for things like object and sets where the value can vary
        delete actual.value;
        try {
            assert.deepEqual(expected, actual);
            return true;
        } catch {
            return false;
        }
    }
}
