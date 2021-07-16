import { Resizable } from 're-resizable';
import * as React from 'react';

interface IProps {
    title: string;
    panel: React.ReactElement;
    collapsed: boolean;
    height: string;
}

interface IState {}

export class SidePanelSection extends React.Component<IProps, IState> {
    render() {
        return (
            <details
                open={this.props.collapsed ? undefined : true}
                className="slicing-control"
                style={{
                    borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                    paddingTop: '4px',
                    paddingBottom: '4px'
                }}
            >
                <summary className="slice-summary">
                    <h3 className="slice-summary-detail">{this.props.title}</h3>
                </summary>
                <Resizable
                    style={{
                        overflowY: 'auto', // Bug: When given the ability to scroll, the resize element does not move with scroll
                        zIndex: 99997
                    }}
                    defaultSize={{ width: '100%', height: this.props.height }}
                    handleStyles={{
                        bottom: {
                            bottom: '0px'
                        }
                    }}
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
                    {this.props.panel}
                </Resizable>
            </details>
        );
    }
}

export default SidePanelSection;
