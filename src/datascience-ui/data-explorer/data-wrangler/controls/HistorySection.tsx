import { IList, List } from '@fluentui/react';
import * as React from 'react';
import { mergeStyleSets, getTheme, normalize } from 'office-ui-fabric-react/lib/Styling';
import './HistorySection.css';
import { SidePanelSection } from './SidePanelSection';
import { DataWranglerCommands, IHistoryItem } from '../../../../client/datascience/data-viewing/data-wrangler/types';
import { getLocString } from '../../../react-common/locReactSide';

interface IProps {
    collapsed: boolean;
    currentVariableName: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    historyList: IHistoryItem[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    currentVariableIndex: number | undefined;
    sortAsc: boolean;
}

const theme = getTheme();
export const styles = mergeStyleSets({
    container: {
        overflow: 'auto',
        maxHeight: 300,
        marginTop: 4,
        backgroundColor: 'var(--vscode-sideBar-background) !important',
        selectors: {
            '.ms-List-cell:nth-child(odd)': {
                backgroundColor: 'var(--override-selection-background, var(--vscode-list-hoverBackground))',
                color: 'var(--vscode-list-hoverForeground)'
            },
            '.ms-List-cell:nth-child(even)': {
                backgroundColor: 'var(--vscode-sideBar-background)',
                color: 'var(--vscode-sideBar-foreground)'
            },
            '&:hover': { background: theme.palette.neutralLight }
        }
    },
    itemContent: [
        theme.fonts.medium,
        normalize,
        {
            position: 'relative',
            boxSizing: 'border-box',
            fontFamily: 'var(--vscode-font-family)',
            fontSize: 'var(--vscode-font-size)',
            fontWeight: 'var(--vscode-font-weight)',
            display: 'flex',
            paddingLeft: 10,
            paddingRight: 0
        }
    ]
});

export class HistorySection extends React.Component<IProps, IState> {
    private listRef = React.createRef<IList>();

    constructor(props: IProps) {
        super(props);
        this.state = { currentVariableIndex: 0, sortAsc: true };
        this.viewHistoryItem = this.viewHistoryItem.bind(this);
    }

    componentDidUpdate(prevProps: IProps) {
        if (prevProps.currentVariableName !== this.props.currentVariableName) {
            // New transform applied, tell the list to rerender
            const currentVariableIndex = this.props.currentVariableName!.slice(2)
                ? parseInt(this.props.currentVariableName!.slice(2))
                : 0;
            this.setState({ currentVariableIndex });
            setTimeout(() => {
                this.listRef.current?.forceUpdate();
            });
        }
    }

    handleDeleteHistoryItem(index: number | undefined) {
        if (index !== undefined) {
            this.props.submitCommand({
                command: DataWranglerCommands.RemoveHistoryItem,
                args: {
                    index
                }
            });
            this.setState({ currentVariableIndex: index - 1 });
            setTimeout(() => {
                this.listRef.current?.forceUpdate();
            });
        }
    }

    respondToPreview(doesAccept: boolean) {
        this.props.submitCommand({
            command: DataWranglerCommands.RespondToPreview,
            args: {
                doesAccept
            }
        });
    }

    viewHistoryItem(index: number | undefined) {
        if (index !== undefined) {
            this.props.submitCommand({
                command: DataWranglerCommands.GetHistoryItem,
                args: {
                    index
                }
            });
            this.setState({ currentVariableIndex: index });
            setTimeout(() => {
                this.listRef.current?.forceUpdate();
            });
        }
    }

    renderSideIcons(item?: IHistoryItem, index?: number) {
        if (index !== 0 && item?.isPreview) {
            return (
                <>
                    <div
                        className="codicon codicon-check codicon-button codicon-history-list"
                        onClick={() => this.respondToPreview(true)}
                        title={getLocString('DataScience.dataWranglerAcceptStep', 'Accept Step')}
                    />
                    <div
                        className="codicon codicon-close codicon-button codicon-history-list"
                        onClick={() => this.respondToPreview(false)}
                        title={getLocString('DataScience.dataWranglerRejectStep', 'Reject Step')}
                    />
                </>
            );
        } else if (index !== 0 && this.props.historyList.length - 1 === index && !item?.isPreview) {
            // Need to check that it is the latest operation that is not preview
            return (
                <div
                    className="codicon codicon-discard codicon-button codicon-history-list show-on-hover-child"
                    onClick={() => this.handleDeleteHistoryItem(index)}
                    title={getLocString('DataScience.dataWranglerRemoveStep', 'Remove Step')}
                />
            );
        }
    }

    getAdjustedIndex(index?: number) {
        // If sorted in ascending order [A, B, C, D] then the index is what it usually is
        // If sorted in descending order, then the actual list has changed to [D, C, B, A]
        // and getAdjustedIndex will return the adjusted index that would correspond to
        // the same element as if we had it sorted ascending
        // Eg. index=1, sortAsc=true, listOrder=[A, B, C, D] => return 1 (corresponds to B)
        // Eg. index=1, sortDesc=true, listOrder=[D, C, B, A] => return 2 (corresponds to B)
        return this.state.sortAsc ? index : this.props.historyList.length - (index ?? 0) - 1;
    }

    onRenderCell = (item?: IHistoryItem, index?: number): JSX.Element => {
        const adjustedIndex = this.getAdjustedIndex(index);
        const adjustedCurrentIndex = this.getAdjustedIndex(this.state.currentVariableIndex);
        const isCurrentStep = adjustedCurrentIndex === index!; // df1 corresponds to history item 0
        const className =
            styles.itemContent + ' history-item show-on-hover-parent' + (isCurrentStep ? ' selected-history-item' : '');

        return (
            <div data-is-focusable>
                <div className={className} style={{ paddingBottom: '4px', paddingTop: '2px', paddingRight: '4px' }}>
                    <div
                        style={{ flexGrow: 1 }}
                        onClick={() => this.viewHistoryItem(adjustedIndex)}
                        title={getLocString(
                            'DataScience.dataWranglerViewIntermediateState',
                            'Click to view intermediate state'
                        )}
                    >
                        <span style={{ verticalAlign: 'middle', width: '100%' }}>{item?.description}</span>
                        {item?.isPreview && (
                            <span
                                style={{
                                    verticalAlign: 'bottom',
                                    width: '100%',
                                    color: 'var(--vscode-descriptionForeground)',
                                    fontSize: '10px'
                                }}
                            >
                                &nbsp;&nbsp;&nbsp;{getLocString('DataScience.dataWranglerPreview', 'Preview')}
                            </span>
                        )}
                    </div>
                    {this.renderSideIcons(item, adjustedIndex)}
                </div>
            </div>
        );
    };

    renderSortIcon() {
        const sortClass = this.state.sortAsc ? 'codicon-arrow-up' : 'codicon-arrow-down';
        const sortTooltip = this.state.sortAsc
            ? getLocString('Common.sortAsc', 'Sort Ascending')
            : getLocString('Common.sortDesc', 'Sort Descending');

        return (
            <div
                className={`codicon ${sortClass} codicon-button show-on-hover-child`}
                onClick={(e) => {
                    // Prevents details from opening and closing
                    e.preventDefault();
                    this.setState({ sortAsc: !this.state.sortAsc });
                }}
                title={sortTooltip}
            />
        );
    }

    render() {
        const historyComponent = (
            <div className={styles.container} data-is-scrollable>
                <List
                    componentRef={this.listRef}
                    items={this.state.sortAsc ? this.props.historyList : [...this.props.historyList].reverse()}
                    style={{ marginLeft: '5px', display: 'flex', flexDirection: 'column' }}
                    className="historyList"
                    onRenderCell={this.onRenderCell}
                />
            </div>
        );

        return (
            <SidePanelSection
                title={getLocString('DataScience.dataWranglerPanelHistory', 'HISTORY')}
                panel={historyComponent}
                icon={this.renderSortIcon()}
                collapsed={this.props.collapsed}
                height={'100px'}
            />
        );
    }
}
