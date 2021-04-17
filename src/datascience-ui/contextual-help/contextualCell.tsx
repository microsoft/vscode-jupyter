// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../client/common/extensions';

import { nbformat } from '@jupyterlab/coreutils';
import * as fastDeepEqual from 'fast-deep-equal';
import * as React from 'react';
import { connect } from 'react-redux';

import { CellState } from '../../client/datascience/types';
import { CellOutput } from '../interactive-common/cellOutput';
import { ICellViewModel, IFont } from '../interactive-common/mainState';
import { getLocString } from '../react-common/locReactSide';
import { actionCreators } from './redux/actions';

namespace CssConstants {
    export const CellOutputWrapper = 'cell-output-wrapper';
    export const CellOutputWrapperClass = `.${CellOutputWrapper}`;
    export const ImageButtonClass = '.image-button';
}

interface IContextualCellBaseProps {
    role?: string;
    cellVM: ICellViewModel;
    language: string;

    baseTheme: string;
    codeTheme: string;
    testMode?: boolean;
    maxTextSize?: number;
    enableScroll?: boolean;
    monacoTheme: string | undefined;
    lastCell: boolean;
    firstCell: boolean;
    font: IFont;
    allowUndo: boolean;
}

type IContextualCellProps = IContextualCellBaseProps & typeof actionCreators;

/* eslint-disable  */
export class ContextualCell extends React.Component<IContextualCellProps> {
    private wrapperRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();

    constructor(prop: IContextualCellProps) {
        super(prop);
    }

    public render() {
        return this.renderNormalCell();
    }

    public shouldComponentUpdate(nextProps: IContextualCellProps): boolean {
        return !fastDeepEqual(this.props, nextProps);
    }

    // Public for testing
    public getUnknownMimeTypeFormatString() {
        return getLocString('DataScience.unknownMimeTypeFormat', 'Unknown Mime Type');
    }

    private getCell = () => {
        return this.props.cellVM.cell;
    };

    private isCodeCell = () => {
        return this.props.cellVM.cell.data.cell_type === 'code';
    };

    private renderNormalCell() {
        const cellOuterClass = 'cell-outer';
        const cellWrapperClass = 'cell-wrapper cell-wrapper-noneditable';

        // Content changes based on if a markdown cell or not.
        const content =
            (
                <div className="cell-result-container">
                    <div className="cell-row-container">
                        {this.renderOutput()}
                    </div>
                </div>
            );

        return (
            <div
                className={cellWrapperClass}
                role={this.props.role}
                ref={this.wrapperRef}
                tabIndex={0}
            >
                <div className={cellOuterClass}>
                    <div className="content-div">{content}</div>
                </div>
            </div>
        );
    }
    private hasOutput = () => {
        return (
            this.getCell().state === CellState.finished ||
            this.getCell().state === CellState.error ||
            this.getCell().state === CellState.executing
        );
    };

    private getCodeCell = () => {
        return this.props.cellVM.cell.data as nbformat.ICodeCell;
    };

    private shouldRenderOutput(): boolean {
        if (this.isCodeCell()) {
            const cell = this.getCodeCell();
            return (
                this.hasOutput() &&
                cell.outputs &&
                !this.props.cellVM.hideOutput &&
                Array.isArray(cell.outputs) &&
                cell.outputs.length !== 0
            );
        }
        return false;
    }

    private renderOutput = (): JSX.Element | null => {
        if (this.shouldRenderOutput()) {
            return (
                <div className={CssConstants.CellOutputWrapper}>
                    <CellOutput
                        cellVM={this.props.cellVM}
                        baseTheme={this.props.baseTheme}
                        expandImage={this.props.showPlot}
                        enableScroll={false}
                        themeMatplotlibPlots={false}
                        widgetFailed={this.props.widgetFailed}
                        openSettings={this.props.openSettings}
                    />
                </div>
            );
        }
        return null;
    };

}

// Main export, return a redux connected editor
export function getConnectedContextualCell() {
    return connect(null, actionCreators)(ContextualCell);
}

