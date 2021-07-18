import fastDeepEqual from 'fast-deep-equal';
import * as React from 'react';
// Need to do like this because react-plotly depends on poltly.js normally
// but we will use plotly.js-dist
import createPlotlyComponent from 'react-plotly.js/factory';
const Plotly = require('plotly.js-dist');
import {
    IDataFrameColumnInfo,
    IDataFrameInfo,
    IGetColsResponse
} from '../../../../client/datascience/data-viewing/types';
import { getLocString } from '../../../react-common/locReactSide';
import { SidePanelSection } from './SidePanelSection';
import { summaryChildRowStyle, summaryInnerRowStyle, summaryRowStyle } from './styles';

interface ISummarySectionProps {
    collapsed: boolean;
    resizeEvent: Slick.Event<void>;
    histogramData: IGetColsResponse | undefined;
    dataframeSummary: IDataFrameInfo;
    selectedColumns: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monacoThemeObj: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IDataframeColumnSummaryProps {
    columnSummary?: IDataFrameColumnInfo;
    shape: string;
    rowCount: number;
    showDefaultSummary(show: boolean): void;
}

interface ISummaryRowProps {
    name: string;
    value: string | number | undefined;
    child?: boolean;
}

interface IInnerRowsProps {
    children: ISummaryRowProps[];
}

interface ISummaryTitleProps {
    name: string;
    canClose: boolean;
    showDefaultSummary(show: boolean): void;
}

interface IHistogramProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    themeObj: any;
    column: string;
}

interface IState {
    showDefaultSummary: boolean;
    isStateUpdate: boolean;
}

const Plot = createPlotlyComponent(Plotly);

class SummaryRow extends React.Component<ISummaryRowProps> {
    render() {
        return (
            <div style={this.props.child ? summaryChildRowStyle : summaryRowStyle}>
                <span>{this.props.name}</span>
                <span>{this.props.value}</span>
            </div>
        );
    }
}

class SummaryTitle extends React.Component<ISummaryTitleProps> {
    render() {
        return (
            <div style={{ ...summaryRowStyle, fontWeight: 'bold' }}>
                <span>Column: {this.props.name}</span>
                {this.props.canClose && (
                    <div
                        className="codicon codicon-close codicon-button"
                        onClick={() => {
                            this.props.showDefaultSummary(true);
                        }}
                        style={{ verticalAlign: 'middle' }}
                        title={getLocString('DataScience.dataWranglerCloseColumnSummary', 'Close column summary')}
                    />
                )}
            </div>
        );
    }
}

class InnerRows extends React.Component<IInnerRowsProps> {
    render() {
        return (
            <div style={summaryInnerRowStyle}>
                {this.props.children.map((c) => (
                    <SummaryRow key={c.name} child={true} name={c.name} value={c.value} />
                ))}
            </div>
        );
    }
}

class ColumnSummary extends React.Component<IDataframeColumnSummaryProps> {
    render() {
        if (!this.props.columnSummary) {
            return <></>;
        }
        return (
            <div>
                <SummaryTitle
                    name={this.props.columnSummary.key}
                    canClose={true}
                    showDefaultSummary={this.props.showDefaultSummary}
                />
                <SummaryRow
                    name={getLocString('DataScience.dataWranglerDataFrameShape', 'Data frame shape')}
                    value={this.props.shape}
                />
                <SummaryRow
                    name={getLocString('DataScience.dataWranglerUniqueValues', 'Unique values')}
                    value={this.props.columnSummary.uniqueCount}
                />
                <SummaryRow name={getLocString('DataScience.dataWranglerRows', 'Rows')} value={this.props.rowCount} />
                <InnerRows
                    children={[
                        {
                            name: getLocString('DataScience.dataWranglerNumberMissingValues', '# Missing values'),
                            value: this.props.columnSummary.missingCount
                        },
                        {
                            name: getLocString('DataScience.dataWranglerPercentMissingValues', '% Missing values'),
                            value: calculatePercent(
                                this.props.columnSummary.missingCount ?? 0,
                                this.props.rowCount ?? 0
                            )
                        }
                    ]}
                />
                {/* Only shows up for numerical columns */}
                {this.props.columnSummary.statistics && (
                    <>
                        <SummaryRow
                            name={getLocString('DataScience.dataWranglerStatistics', 'Statistics')}
                            value={undefined}
                        />
                        <InnerRows
                            children={[
                                {
                                    name: getLocString('DataScience.dataWranglerAverage', 'Average'),
                                    value: this.props.columnSummary.statistics.average
                                },
                                {
                                    name: getLocString('DataScience.dataWranglerMedian', 'Median'),
                                    value: this.props.columnSummary.statistics.median
                                },
                                {
                                    name: getLocString('DataScience.dataWranglerMin', 'Min'),
                                    value: this.props.columnSummary.statistics.min
                                },
                                {
                                    name: getLocString('DataScience.dataWranglerMax', 'Max'),
                                    value: this.props.columnSummary.statistics.max
                                },
                                {
                                    name: getLocString(
                                        'DataScience.dataWranglerStandardDeviation',
                                        'Standard deviation'
                                    ),
                                    value: this.props.columnSummary.statistics.sd
                                }
                            ]}
                        />
                    </>
                )}
                {/* Only shows up for string/object columns */}
                {this.props.columnSummary.mostFrequentValue && (
                    <>
                        <SummaryRow
                            name={getLocString('DataScience.dataWranglerMostFrequent', 'Most frequent')}
                            value={this.props.columnSummary.mostFrequentValue}
                        />
                        <InnerRows
                            children={[
                                {
                                    name: getLocString('DataScience.dataWranglerNumberOccurences', '# Occurences'),
                                    value: this.props.columnSummary.mostFrequentValueAppearances
                                }
                            ]}
                        />
                    </>
                )}
            </div>
        );
    }
}

class DataframeSummary extends React.Component<IDataFrameInfo> {
    render() {
        return (
            <div>
                <SummaryRow
                    name={getLocString('DataScience.dataWranglerDataFrameShape', 'Data frame shape')}
                    value={shapeAsString(this.props.shape)}
                />
                <SummaryRow
                    name={getLocString('DataScience.dataWranglerColumns', 'Columns')}
                    value={this.props.columns?.length}
                />
                <SummaryRow name={getLocString('DataScience.dataWranglerRows', 'Rows')} value={this.props.rowCount} />
                <InnerRows
                    children={[
                        {
                            name: getLocString('DataScience.dataWranglerNumberMissingValues', '# Missing values'),
                            value: this.props.nanRows?.length
                        },
                        {
                            name: getLocString('DataScience.dataWranglerPercentMissingValues', '% Missing values'),
                            value: calculatePercent(this.props.nanRows?.length ?? 0, this.props.rowCount ?? 0)
                        },
                        {
                            name: getLocString('DataScience.dataWranglerNumberDuplicateRows', '# Duplicate rows'),
                            value: this.props.duplicateRowsCount
                        },
                        {
                            name: getLocString(
                                'DataScience.dataWranglerPercentDuplicateRows',
                                '% Rows with duplicates'
                            ),
                            value: calculatePercent(this.props.duplicateRowsCount ?? 0, this.props.rowCount ?? 0)
                        }
                    ]}
                />
                <SummaryRow
                    name={getLocString('DataScience.dataWranglerMissingValues', 'Missing values')}
                    value={this.props.nanRows?.length}
                />
                <InnerRows children={getColumnsWithMissingValues(this.props.columns ?? [])} />
            </div>
        );
    }
}

export class Histogram extends React.Component<IHistogramProps> {
    render() {
        const layout = {
            autosize: true,
            margin: {
                t: 50,
                b: 50,
                l: 50,
                r: 50,
                pad: 10
            },
            // colorway: [this.props.themeObj.colors['sideBarTitle.foreground']],
            plot_bgcolor: this.props.themeObj.colors['editor.background'],
            paper_bgcolor: this.props.themeObj.colors['editor.background'],
            font: {
                color: this.props.themeObj.colors['editor.foreground']
            },
            title: this.props.column
        } as Plotly.Layout;

        return (
            <div style={{ marginRight: '15px', paddingRight: '15px' }}>
                <Plot
                    style={{
                        marginLeft: '20px',
                        marginRight: '20px',
                        marginTop: '16px',
                        width: '100%',
                        height: '250px'
                    }}
                    data={[
                        {
                            x: this.props.data,
                            type: 'histogram'
                        }
                    ]}
                    layout={layout}
                    useResizeHandler={true}
                />
            </div>
        );
    }
}

export class SummarySection extends React.Component<ISummarySectionProps, IState> {
    constructor(props: ISummarySectionProps) {
        super(props);
        this.state = { showDefaultSummary: true, isStateUpdate: false };
        this.props.resizeEvent.subscribe(() => {
            this.forceUpdate();
        });
    }

    private showDefaultSummary(show: boolean) {
        this.setState({ showDefaultSummary: show, isStateUpdate: true });
    }

    static getDerivedStateFromProps(nextProps: ISummarySectionProps, nextState: IState) {
        if (nextState.isStateUpdate) {
            // Someone pressed X button so show default summary
            return { showDefaultSummary: nextState.showDefaultSummary, isStateUpdate: false };
        }
        if (nextProps.histogramData === undefined) {
            // If histogram data is undefined, don't need to change state because it only renders when it is defined
            return null;
        }
        return { showDefaultSummary: false, isStateUpdate: false };
    }

    shouldComponentUpdate(nextProps: ISummarySectionProps, nextState: IState) {
        if (this.state.showDefaultSummary && nextState.showDefaultSummary) {
            // Next state and this state both shows default summary so don't need to re-render
            return false;
        }
        if (fastDeepEqual(this.props.histogramData, nextProps.histogramData) && !nextState.showDefaultSummary) {
            // Next props and this props have same histogram data so don't need to re-render
            return false;
        }
        if (nextState.showDefaultSummary && this.props.histogramData === undefined) {
            // Currently showing default summary because of undefined props.histogramData so we would still show default summary
            return false;
        }
        if (this.state.showDefaultSummary && nextProps.histogramData === undefined) {
            // Currently showing default summary because of state.showDefaultSummary and next props.histogramData is undefined so we would sitll show default summary
            return false;
        }
        return true;
    }

    render() {
        let columnInfo = undefined;
        if (!this.state.showDefaultSummary && this.props.histogramData !== undefined) {
            const columnInfos = this.props.dataframeSummary.columns?.filter(
                (c) => c.key === this.props.histogramData?.columnName
            );
            if (columnInfos && columnInfos.length > 0) {
                columnInfo = columnInfos[0];
            }
        }
        const summaryComponent =
            columnInfo !== undefined ? (
                <>
                    <ColumnSummary
                        columnSummary={columnInfo}
                        shape={shapeAsString(this.props.dataframeSummary.shape)}
                        rowCount={this.props.dataframeSummary.rowCount ?? 0}
                        showDefaultSummary={this.showDefaultSummary.bind(this)}
                    />
                    {this.props.histogramData && this.props.histogramData.cols.length > 0 && (
                        <Histogram
                            data={this.props.histogramData.cols}
                            themeObj={this.props.monacoThemeObj}
                            column={this.props.histogramData?.columnName}
                        />
                    )}
                </>
            ) : (
                <DataframeSummary {...this.props.dataframeSummary} />
            );

        return (
            <SidePanelSection
                title={getLocString('DataScience.dataWranglerPanelSummary', 'SUMMARY')}
                panel={summaryComponent}
                collapsed={this.props.collapsed}
                height={'200px'}
            />
        );
    }
}

function shapeAsString(shape: number[] | undefined) {
    return shape ? shape.join(' x ') : '';
}

function calculatePercent(partialValue: number, totalValue: number) {
    if (totalValue === 0) {
        return '100%';
    }
    // Convert it to a float with 1 decimal point then cast it as number to get rid of any trailing zeros if there are some
    return Number(((partialValue / totalValue) * 100).toFixed(2)).toString() + '%';
}

function getColumnsWithMissingValues(cols: IDataFrameColumnInfo[]): ISummaryRowProps[] {
    // Filters for columns that have missing values then sorts them by who is missing the most
    const resultCols = cols
        .filter((col) => col.missingCount && col.missingCount > 0)
        ?.map((col) => ({ name: col.key, value: col.missingCount } as ISummaryRowProps))
        .sort((a, b) => (b.value as number) - (a.value as number));
    return resultCols;
}
