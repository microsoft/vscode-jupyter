// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { CellMatcher } from './cellMatcher';
import { IJupyterSettings } from '../../platform/common/types';
import { defaultDataScienceSettings } from '../../test/datascience/helpers.node';

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
            assert.equal(defaultMatcher.getCellType(cellMarker), 'code', `"${cellMarker}" should be detected as code cell type`);
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
            assert.equal(defaultMatcher.getCellType(cellMarker), 'markdown', `"${cellMarker}" should be detected as markdown cell type`);
        });
    });

    const rawCellMarkers = [
        '# %% [raw]',
        '#%%[raw]',
        '#   %%    [raw]',
        '# %% [raw] extra stuff',
        '   # %% [raw]   '
    ];
    rawCellMarkers.forEach((cellMarker) => {
        test('CellMatcher for valid raw cell', () => {
            assert.ok(defaultMatcher.isCell(cellMarker), `"${cellMarker}" should match as a cell marker`);
            assert.ok(defaultMatcher.isRaw(cellMarker), `"${cellMarker}" should match as a raw cell marker`);
            assert.equal(defaultMatcher.getCellType(cellMarker), 'raw', `"${cellMarker}" should be detected as raw cell type`);
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
