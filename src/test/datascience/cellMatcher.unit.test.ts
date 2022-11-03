// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { assert } from 'chai';
import { CellMatcher } from '../../interactive-window/editor-integration/cellMatcher';
import { IJupyterSettings } from '../../platform/common/types';
import { defaultDataScienceSettings } from './helpers.node';

suite('CellMatcher', () => {
    const settings: IJupyterSettings = defaultDataScienceSettings();
    const defaultMatcher = new CellMatcher(settings);

    const codeCellMarkers = [
        '# %%',
        '#%%',
        '#   %%',
        '# %% extra stuff',
        '   # %%     ',
        '   # %% extra stuff',
        '  #%%'
    ];
    codeCellMarkers.forEach((cellMarker) => {
        test('CellMatcher for valid code cell', () => {
            assert.ok(defaultMatcher.isCell(cellMarker), `"${cellMarker}" should match as a cell marker`);
            assert.ok(defaultMatcher.isCode(cellMarker), `"${cellMarker}" should match as a code cell marker`);
        });
    });

    const markdownCellMarkers = [
        '# %% [markdown]',
        '#%%[markdown]',
        '#   %%    [markdown]',
        '# %% [markdown] extra stuff',
        '   # %% [markdown]   ',
        '# <markdowncell>',
        '#<markdowncell>',
        '#    <markdowncell>',
        '# <markdowncell> extra stuff'
    ];
    markdownCellMarkers.forEach((cellMarker) => {
        test('CellMatcher for valid markdown cell', () => {
            assert.ok(defaultMatcher.isCell(cellMarker), `"${cellMarker}" should match as a cell marker`);
            assert.ok(defaultMatcher.isMarkdown(cellMarker), `"${cellMarker}" should match as a markdown cell marker`);
        });
    });

    const invalidCellMarkers = ['', 'print(1);', '# ! %%'];
    invalidCellMarkers.forEach((cellMarker) => {
        test('CellMatcher for valid markdown cell', () => {
            assert.isFalse(defaultMatcher.isCell(cellMarker), `"${cellMarker}" should not match as a cell marker`);
        });
    });

    const customSettings: IJupyterSettings = defaultDataScienceSettings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (<any>customSettings).defaultCellMarker = '# CODE HERE';
    const cusomMatcher = new CellMatcher(customSettings);
    const customCellMakers = ['# %%', '# CODE HERE', '   # CODE HERE    '];
    customCellMakers.forEach((cellMarker) => {
        test('Custom Default cell setting for valid code cell', () => {
            assert.ok(cusomMatcher.isCell(cellMarker), `"${cellMarker}" should match as a cell marker`);
            assert.ok(cusomMatcher.isCode(cellMarker), `"${cellMarker}" should match as a code cell marker`);
        });
    });
});
