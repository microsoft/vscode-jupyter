// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as React from 'react';
import { connect } from 'react-redux';
import { IJupyterExtraSettings } from '../../client/datascience/types';
import { JupyterInfo } from '../interactive-common/jupyterInfo';
import {
    getSelectedAndFocusedInfo,
    ICellViewModel,
    IFont,
    IServerState,
    SelectionAndFocusedInfo,
    ServerStatus
} from '../interactive-common/mainState';
import { IStore } from '../interactive-common/redux/store';
import { Image, ImageName } from '../react-common/image';
import { ImageButton } from '../react-common/imageButton';
import { getLocString } from '../react-common/locReactSide';
import './scratchPanel.less';
import { actionCreators } from './redux/actions';

type IScratchDataProps = {
    title?: string;
    busy: boolean;
    dirty: boolean;
    baseTheme: string;
    cellCount: number;
    font: IFont;
    kernel: IServerState;
    selectionFocusedInfo: SelectionAndFocusedInfo;
    settings?: IJupyterExtraSettings;
    cellVMs: ICellViewModel[];
};
export type IScratchToolbarProps = IScratchDataProps & {
    clearAllOutputs: typeof actionCreators.clearAllOutputs;
    export: typeof actionCreators.export;
    exportAs: typeof actionCreators.exportAs;
    save: typeof actionCreators.save;
    restartKernel: typeof actionCreators.restartKernel;
    interruptKernel: typeof actionCreators.interruptKernel;
    selectKernel: typeof actionCreators.selectKernel;
    selectServer: typeof actionCreators.selectServer;
    launchNotebookTrustPrompt: typeof actionCreators.launchNotebookTrustPrompt;
};

function mapStateToProps(state: IStore): IScratchDataProps {
    return {
        ...state.main,
        cellCount: state.main.cellVMs.length,
        selectionFocusedInfo: getSelectedAndFocusedInfo(state.main)
    };
}

export class Toolbar extends React.PureComponent<IScratchToolbarProps> {

    /* eslint-disable  */
    // eslint-disable-next-line
    public render() {
        const canRestartAndInterruptKernel = this.props.kernel.jupyterServerStatus !== ServerStatus.NotStarted;

        return (
            <div id="toolbar-panel">
                <div className="toolbar-menu-bar">
                    <div className="toolbar-menu-bar-child">
                        <ImageButton
                            baseTheme={this.props.baseTheme}
                            onClick={this.props.restartKernel}
                            disabled={!canRestartAndInterruptKernel}
                            className="native-button"
                            tooltip={getLocString('DataScience.restartServer', 'Restart Jupyter kernel')}
                        >
                            <Image
                                baseTheme={this.props.baseTheme}
                                class="image-button-image"
                                image={ImageName.Restart}
                            />
                        </ImageButton>
                        <ImageButton
                            baseTheme={this.props.baseTheme}
                            onClick={this.props.interruptKernel}
                            disabled={!canRestartAndInterruptKernel}
                            className="native-button"
                            tooltip={getLocString('DataScience.interruptKernel', 'Interrupt Jupyter kernel')}
                        >
                            <Image
                                baseTheme={this.props.baseTheme}
                                class="image-button-image"
                                image={ImageName.Interrupt}
                            />
                        </ImageButton>
                        <ImageButton
                            baseTheme={this.props.baseTheme}
                            onClick={this.props.clearAllOutputs}
                            disabled={!this.props.cellCount}
                            className="native-button"
                            tooltip={getLocString('DataScience.clearAllOutput', 'Clear All Output')}
                        >
                            <Image
                                baseTheme={this.props.baseTheme}
                                class="image-button-image"
                                image={ImageName.ClearAllOutput}
                            />
                        </ImageButton>
                    </div>
                    <JupyterInfo
                        baseTheme={this.props.baseTheme}
                        font={this.props.font}
                        kernel={this.props.kernel}
                        title={undefined}
                        selectServer={undefined}
                        selectKernel={undefined}
                        shouldShowTrustMessage={false}
                        isNotebookTrusted={true}
                        launchNotebookTrustPrompt={undefined}
                    />
                </div>
                <div className="toolbar-divider" />
            </div>
        );
    }
}

export const ToolbarComponent = connect(mapStateToProps, actionCreators)(Toolbar);
