// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { expect } from 'chai';

// Basic shape of a variable result
export interface IVariableInfo {
    name: string;
    type: string;
    length: string;
    value: string;
}

// For the given html, verify that the expected variables are in it
export function verifyViewVariables(expected: IVariableInfo[], html: string) {
    const htmlVariables = parseVariableViewHTML(html);

    // Check our size first
    expect(htmlVariables.length).to.be.equal(expected.length, 'Did not find expected number of variables');

    expected.forEach((expectedInfo, index) => {
        compareVariableInfos(expectedInfo, htmlVariables[index]);
    });
}

// Helper function to parse the view HTML
function parseVariableViewHTML(html: string): IVariableInfo[] {
    const parser = new DOMParser();
    const htmlDoc = parser.parseFromString(html, 'text/html');
    const variableRows = htmlDoc.getElementsByClassName('react-grid-Row');

    const variableInfos: IVariableInfo[] = [];
    // HTMLCollectionOf doesn't support nice iterators
    for (let index = 0; index < variableRows.length; index++) {
        variableInfos.push(extractVariableFromRow(variableRows[index]));
    }

    return variableInfos;
}

// From a single row pull out the values we care about
function extractVariableFromRow(variableHTMLRow: Element): IVariableInfo {
    const cellElements = variableHTMLRow.querySelectorAll('[role=cell]');
    return {
        name: cellElements[0].innerHTML,
        type: cellElements[1].innerHTML,
        length: cellElements[2].innerHTML,
        value: cellElements[3].innerHTML
    };
}

// Compare two variable infos
function compareVariableInfos(expected: IVariableInfo, actual: IVariableInfo) {
    expect(expected).to.deep.equal(actual, 'Found Variable incorrect');
}
