// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as React from 'react';
import { connect } from 'react-redux';
import { Identifiers } from '../../client/datascience/constants';
import { buildSettingsCss } from '../interactive-common/buildSettingsCss';
import { ContentPanel, IContentPanelProps } from '../interactive-common/contentPanel';
import { handleLinkClick } from '../interactive-common/handlers';
import { JupyterInfo } from '../interactive-common/jupyterInfo';
import { ICellViewModel } from '../interactive-common/mainState';
import { IMainWithVariables, IStore } from '../interactive-common/redux/store';
import { IVariablePanelProps, VariablePanel } from '../interactive-common/variablePanel';
import { ErrorBoundary } from '../react-common/errorBoundary';
import { Image, ImageName } from '../react-common/image';
import { ImageButton } from '../react-common/imageButton';
import { getLocString } from '../react-common/locReactSide';
import { Progress } from '../react-common/progress';
import './interactivePanel.less';
import { actionCreators } from './redux/actions';

// tslint:disable: no-suspicious-comment

export type IInteractivePanelProps = IMainWithVariables & typeof actionCreators;

function mapStateToProps(state: IStore): IMainWithVariables {
    return { ...state.main, variableState: state.variables };
}

export class VariableViewPanel extends React.Component<IInteractivePanelProps> {
    private mainPanelRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();
    private mainPanelToolbarRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();
    private contentPanelRef: React.RefObject<ContentPanel> = React.createRef<ContentPanel>();
    private renderCount: number = 0;
    private internalScrollCount: number = 0;

    constructor(props: IInteractivePanelProps) {
        super(props);
    }

    public componentDidMount() {
        document.addEventListener('click', this.linkClick, true);
        this.props.editorLoaded();
    }

    public componentWillUnmount() {
        document.removeEventListener('click', this.linkClick);
        this.props.editorUnmounted();
    }

    public render() {
        const dynamicFont: React.CSSProperties = {
            fontSize: this.props.font.size,
            fontFamily: this.props.font.family
        };

        const progressBar = (this.props.busy || !this.props.loaded) && !this.props.testMode ? <Progress /> : undefined;

        // If in test mode, update our count. Use this to determine how many renders a normal update takes.
        if (this.props.testMode) {
            this.renderCount = this.renderCount + 1;
        }

        return (
            <div>
                <h1>VARIABLES</h1>
            </div>
        );

        //return (
        //<div id="main-panel" ref={this.mainPanelRef} role="Main" style={dynamicFont}>
        //<div className="styleSetter">
        //<style>{`${this.props.rootCss ? this.props.rootCss : ''}
        //${buildSettingsCss(this.props.settings)}`}</style>
        //</div>
        //<header id="main-panel-toolbar" ref={this.mainPanelToolbarRef}>
        //{this.renderToolbarPanel()}
        //{progressBar}
        //</header>
        //<section
        //id="main-panel-variable"
        //aria-label={getLocString('DataScience.collapseVariableExplorerLabel', 'Variables')}
        //>
        //{this.renderVariablePanel(this.props.baseTheme)}
        //</section>
        //<main id="main-panel-content" onScroll={this.handleScroll}>
        //{this.renderContentPanel(this.props.baseTheme)}
        //</main>
        //<section
        //id="main-panel-footer"
        //onClick={this.footerPanelClick}
        //aria-label={getLocString('DataScience.editSection', 'Input new cells here')}
        //>
        //{this.renderFooterPanel(this.props.baseTheme)}
        //</section>
        //</div>
        //);
    }

    private renderVariablePanel(baseTheme: string) {
        if (this.props.variableState.visible) {
            const variableProps = this.getVariableProps(baseTheme);
            return <VariablePanel {...variableProps} />;
        }

        return null;
    }

    private getVariableProps = (baseTheme: string): IVariablePanelProps => {
        let toolbarHeight = 0;
        if (this.mainPanelToolbarRef.current) {
            toolbarHeight = this.mainPanelToolbarRef.current.offsetHeight;
        }
        return {
            gridHeight: this.props.variableState.gridHeight,
            containerHeight: this.props.variableState.containerHeight,
            variables: this.props.variableState.variables,
            debugging: this.props.debugging,
            busy: this.props.busy,
            showDataExplorer: this.props.showDataViewer,
            skipDefault: this.props.skipDefault,
            testMode: this.props.testMode,
            closeVariableExplorer: this.props.toggleVariableExplorer,
            setVariableExplorerHeight: this.props.setVariableExplorerHeight,
            baseTheme: baseTheme,
            pageIn: this.pageInVariableData,
            fontSize: this.props.font.size,
            executionCount: this.props.currentExecutionCount,
            refreshCount: this.props.variableState.refreshCount,
            offsetHeight: toolbarHeight
        };
    };

    private pageInVariableData = (startIndex: number, pageSize: number) => {
        this.props.getVariableData(
            this.props.currentExecutionCount,
            this.props.variableState.refreshCount,
            startIndex,
            pageSize
        );
    };

    private linkClick = (ev: MouseEvent) => {
        handleLinkClick(ev, this.props.linkClick);
    };
}

// Main export, return a redux connected editor
export function getConnectedInteractiveEditor() {
    return connect(mapStateToProps, actionCreators)(VariableViewPanel);
}
