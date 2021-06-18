// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const cloneDeep = require('lodash/cloneDeep');
import * as uuid from 'uuid/v4';

import { CellMatcher } from '../../../../client/datascience/cellMatcher';
import { InteractiveWindowMessages } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { CellState } from '../../../../client/datascience/types';
import { generateMarkdownFromCodeLines } from '../../../common';
import { createCellFrom } from '../../../common/cellFactory';
import { createCellVM, IMainState } from '../../../interactive-common/mainState';
import { postActionToExtension } from '../../../interactive-common/redux/helpers';
import { Helpers } from '../../../interactive-common/redux/reducers/helpers';
import { ICodeAction } from '../../../interactive-common/redux/reducers/types';
import { InteractiveReducerArg } from '../mapping';
import { Creation } from './creation';

export namespace Execution {
    export function undo(arg: InteractiveReducerArg): IMainState {
        if (arg.prevState.undoStack.length > 0) {
            // Pop one off of our undo stack and update our redo
            const cells = arg.prevState.undoStack[arg.prevState.undoStack.length - 1];
            const undoStack = arg.prevState.undoStack.slice(0, arg.prevState.undoStack.length - 1);
            const redoStack = Helpers.pushStack(arg.prevState.redoStack, arg.prevState.cellVMs);
            postActionToExtension(arg, InteractiveWindowMessages.Undo);
            return {
                ...arg.prevState,
                cellVMs: cells,
                undoStack: undoStack,
                redoStack: redoStack,
                skipNextScroll: true
            };
        }

        return arg.prevState;
    }

    export function redo(arg: InteractiveReducerArg): IMainState {
        if (arg.prevState.redoStack.length > 0) {
            // Pop one off of our redo stack and update our undo
            const cells = arg.prevState.redoStack[arg.prevState.redoStack.length - 1];
            const redoStack = arg.prevState.redoStack.slice(0, arg.prevState.redoStack.length - 1);
            const undoStack = Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs);
            postActionToExtension(arg, InteractiveWindowMessages.Redo);
            return {
                ...arg.prevState,
                cellVMs: cells,
                undoStack: undoStack,
                redoStack: redoStack,
                skipNextScroll: true
            };
        }

        return arg.prevState;
    }

    export function startDebugging(arg: InteractiveReducerArg): IMainState {
        return {
            ...arg.prevState,
            debugging: true
        };
    }

    export function stopDebugging(arg: InteractiveReducerArg): IMainState {
        return {
            ...arg.prevState,
            debugging: false
        };
    }

    export function submitInput(arg: InteractiveReducerArg<ICodeAction>): IMainState {
        // noop if the submitted code is just a cell marker
        const matcher = new CellMatcher(arg.prevState.settings);
        if (matcher.stripFirstMarker(arg.payload.data.code).length > 0 && arg.prevState.editCellVM) {
            // This should be from the edit cell VM. Copy it and change the cell id
            let newCell = cloneDeep(arg.prevState.editCellVM);

            // Change this editable cell to not editable.
            newCell.cell.state = CellState.executing;
            newCell.cell.data.source = arg.payload.data.code;

            // Change type to markdown if necessary
            const split = arg.payload.data.code.splitLines({ trim: false });
            const firstLine = split[0];
            if (matcher.isMarkdown(firstLine)) {
                newCell.cell.data = createCellFrom(newCell.cell.data, 'markdown');
                newCell.cell.data.source = generateMarkdownFromCodeLines(split);
                newCell.cell.state = CellState.finished;
            } else if (newCell.cell.data.cell_type === 'markdown') {
                newCell.cell.state = CellState.finished;
            }

            // Update input controls (always show expanded since we just edited it.)
            newCell = createCellVM(newCell.cell, arg.prevState.settings, false, false);
            const collapseInputs = arg.prevState.settings
                ? arg.prevState.settings.collapseCellInputCodeByDefault
                : false;
            newCell = Creation.alterCellVM(newCell, arg.prevState.settings, true, !collapseInputs);
            newCell.useQuickEdit = false;

            // Generate a new id
            newCell.cell.id = uuid();

            // Indicate this is direct input so that we don't hide it if the user has
            // hide all inputs turned on.
            newCell.directInput = true;

            // Send a message to execute this code if necessary.
            if (newCell.cell.state !== CellState.finished) {
                postActionToExtension(arg, InteractiveWindowMessages.SubmitNewCell, {
                    code: arg.payload.data.code,
                    id: newCell.cell.id
                });
            }

            // Stick in a new cell at the bottom that's editable and update our state
            // so that the last cell becomes busy
            return {
                ...arg.prevState,
                cellVMs: [...arg.prevState.cellVMs, newCell],
                undoStack: Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs),
                skipNextScroll: false,
                submittedText: true
            };
        }
        return arg.prevState;
    }
}
