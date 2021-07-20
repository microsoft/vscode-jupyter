import { Resizable } from 're-resizable';
import * as React from 'react';

interface IProps {
    title: string;
    panel: React.ReactElement;
    collapsed: boolean;
    height: string;
    icon?: React.ReactElement;
}

interface IState {}

export class SidePanelSection extends React.Component<IProps, IState> {
    render() {
        return (
            <details
                open={this.props.collapsed ? undefined : true}
                className="slicing-control"
                style={{
                    borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)'
                }}
            >
                <summary
                    className="slice-summary"
                    style={{ display: 'flex', alignItems: 'center' /* keeps arrow vertically centered */ }}
                >
                    <div className="show-on-hover-parent" style={{ display: 'inline-flex', flexGrow: 1, justifyContent: 'space-between' }}>
                        <h3 className="slice-summary-detail">{this.props.title}</h3>
                        {!this.props.collapsed && this.props.icon}
                    </div>
                </summary>
                <Resizable
                    style={{
                        overflowY: 'hidden',
                        zIndex: 99997
                    }}
                    defaultSize={{ width: '100%', height: this.props.height }}
                    handleClasses={{ bottom: 'resizable-span resizable-span-horizontal' }}
                    enable={{
                        left: false,
                        top: false,
                        right: false,
                        bottom: true,
                        topRight: false,
                        bottomRight: false,
                        bottomLeft: false,
                        topLeft: false
                    }}
                >
                    {/* Needs to be put in another div like this because otherwise the resizable span does not move with scroll */}
                    <div
                        style={{
                            height: '100%',
                            width: '100%',
                            overflowY: 'auto'
                        }}
                    >
                        {this.props.panel}
                    </div>
                </Resizable>
            </details>
        );
    }
}

export default SidePanelSection;
