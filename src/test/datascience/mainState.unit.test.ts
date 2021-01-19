// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { assert } from 'chai';
import { IJupyterSettings } from '../../client/common/types';
import {
    createEmptyCell,
    CursorPos,
    DebugState,
    extractInputText,
    ICellViewModel
} from '../../datascience-ui/interactive-common/mainState';
import { defaultDataScienceSettings } from './helpers';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('DataScience MainState', () => {
    function cloneVM(cvm: ICellViewModel, newCode: string, debugging?: boolean): ICellViewModel {
        const result = {
            ...cvm,
            cell: {
                ...cvm.cell,
                data: {
                    ...cvm.cell.data,
                    source: newCode
                }
            },
            inputBlockText: newCode,
            runDuringDebug: debugging
        };

        // Typecast so that the build works. ICell.MetaData doesn't like reassigning
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (result as any) as ICellViewModel;
    }

    test('ExtractInputText', () => {
        const settings: IJupyterSettings = defaultDataScienceSettings();
        (<any>settings).stopOnFirstLineWhileDebugging = true;
        const cvm: ICellViewModel = {
            cell: createEmptyCell('1', null),
            inputBlockCollapseNeeded: false,
            inputBlockText: '',
            inputBlockOpen: false,
            inputBlockShow: false,
            editable: false,
            focused: false,
            selected: false,
            scrollCount: 0,
            cursorPos: CursorPos.Current,
            hasBeenRun: false,
            runningByLine: DebugState.Design
        };
        assert.equal(extractInputText(cloneVM(cvm, '# %%\na=1'), settings), 'a=1', 'Cell marker not removed');
        assert.equal(
            extractInputText(cloneVM(cvm, '# %%\nbreakpoint()\na=1'), settings),
            'breakpoint()\na=1',
            'Cell marker not removed'
        );
        assert.equal(
            extractInputText(cloneVM(cvm, '# %%\nbreakpoint()\na=1', true), settings),
            'a=1',
            'Cell marker not removed'
        );
    });
});
