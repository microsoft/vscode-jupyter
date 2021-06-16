import * as React from 'react';
import Plot from 'react-plotly.js';
import { IGetColsResponse } from '../../../../client/datascience/data-viewing/types';
import { SidePanelSection } from './SidePanelSection'
interface IProps {
    headers: string[];
    resizeEvent: Slick.Event<void>;
    histogramData: IGetColsResponse | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {}

export class HistogramSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.props.resizeEvent.subscribe(() => {
            this.forceUpdate();
        });
    }

    render() {
        const histogramComponent = this.props.histogramData &&
            this.props.histogramData.cols &&
            this.props.histogramData.cols.length > 0 ? (
                <Plot
                    style={{
                        marginLeft: '20px',
                        marginRight: '20px',
                        marginTop: '16px',
                        width: '100%',
                        height: '300px'
                    }}
                    data={[
                        {
                            x: this.props.histogramData.cols,
                            type: 'histogram'
                        }
                    ]}
                    layout={{ autosize: true, title: 'Column: ' + this.props.histogramData.columnName }}
                    useResizeHandler={true}
                />
            ) : (
                <span style={{ paddingLeft: '19px', display: 'inline-block', paddingTop: '10px' }}>
                    Right click on a column to view column statistics.
                </span>
            );

        return (
            <SidePanelSection title="HISTOGRAM" panel={histogramComponent}/>
        );
    }
}
