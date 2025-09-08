// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { POSITION_TOP, ReactSVGPanZoom, Tool, Value } from 'react-svg-pan-zoom';
import { SvgLoader } from 'react-svgmt';
import './svgViewer.css';

interface ISvgViewerProps {
    svg: string;
    id: string; // Unique identified for this svg (in case they are the same)
    baseTheme: string;
    themeMatplotlibPlots: boolean;
    size: { width: string; height: string };
    defaultValue: Value | undefined;
    tool: Tool;
    changeValue(value: Value): void;
}

interface ISvgViewerState {
    value: Value;
    tool: Tool;
}

export class SvgViewer extends React.Component<ISvgViewerProps, ISvgViewerState> {
    private svgPanZoomRef: React.RefObject<ReactSVGPanZoom> = React.createRef<ReactSVGPanZoom>();

    constructor(props: ISvgViewerProps) {
        super(props);
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        this.state = { value: props.defaultValue ? props.defaultValue : ({} as Value), tool: props.tool };
    }

    public override componentDidUpdate(prevProps: ISvgViewerProps) {
        // May need to update state if props changed
        if (prevProps.defaultValue !== this.props.defaultValue || this.props.id !== prevProps.id) {
            this.setState({
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                value: this.props.defaultValue ? this.props.defaultValue : ({} as Value),
                tool: this.props.tool
            });
        } else if (this.props.tool !== this.state.tool) {
            this.setState({ tool: this.props.tool });
        }
    }

    public move(offsetX: number, offsetY: number) {
        if (this.svgPanZoomRef && this.svgPanZoomRef.current) {
            this.svgPanZoomRef.current.pan(offsetX, offsetY);
        }
    }

    public zoom(amount: number) {
        if (this.svgPanZoomRef && this.svgPanZoomRef.current) {
            this.svgPanZoomRef.current.zoomOnViewerCenter(amount);
        }
    }

    public override render() {
        const plotBackground = this.props.themeMatplotlibPlots ? 'var(--vscode-notifications-background)' : 'white';

        // Use fixed dimensions for ReactSVGPanZoom instead of AutoSizer to fix panning issues.
        // AutoSizer was constraining the viewport dimensions which caused problems when panning
        // wide but short images horizontally after zooming in. Fixed dimensions provide stable 
        // viewport calculations while CSS styling maintains responsiveness.
        return (
            <div style={{ width: '100%', height: '100%' }}>
                <ReactSVGPanZoom
                    ref={this.svgPanZoomRef}
                    width={800}
                    height={600}
                    toolbarProps={{ position: POSITION_TOP }}
                    detectAutoPan={true}
                    tool={this.state.tool}
                    value={this.state.value}
                    onChangeTool={this.changeTool}
                    onChangeValue={this.changeValue}
                    customToolbar={this.renderToolbar}
                    customMiniature={this.renderMiniature}
                    SVGBackground={'transparent'}
                    background={plotBackground}
                    detectWheel={true}
                    style={{ width: '100%', height: '100%' }}
                >
                    <svg width={this.props.size.width} height={this.props.size.height}>
                        <SvgLoader svgXML={this.props.svg} />
                    </svg>
                </ReactSVGPanZoom>
            </div>
        );
    }

    private changeTool = (tool: Tool) => {
        this.setState({ tool });
    };

    private changeValue = (value: Value) => {
        this.setState({ value });
        this.props.changeValue(value);
    };

    private renderToolbar = () => {
        // Hide toolbar too
        return <div />;
    };

    private renderMiniature = () => {
        return (
            <div /> // Hide miniature
        );
    };
}
