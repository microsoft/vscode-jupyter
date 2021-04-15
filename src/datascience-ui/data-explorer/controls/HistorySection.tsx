import { List } from '@fluentui/react';
import * as React from 'react';
import { mergeStyleSets, getTheme, normalize } from 'office-ui-fabric-react/lib/Styling';
import './HistorySection.css';

interface IProps {
    headers: string[];
    historyList: any[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
}

const theme = getTheme();
const styles = mergeStyleSets({
    container: {
      overflow: 'auto',
      maxHeight: 300,
      marginTop: 20,
      selectors: {
        '.ms-List-cell:nth-child(odd)': {
          background: theme.palette.neutralLighter,
          color: theme.palette.black,
        },
        '.ms-List-cell:nth-child(even)': {
        },
      },
    },
    itemContent: [
      theme.fonts.medium,
      normalize,
      {
        position: 'relative',
        boxSizing: 'border-box',
        display: 'block',
        borderLeft: '3px solid ' + theme.palette.themePrimary,
        paddingLeft: 15,
        paddingRight: 15,
      },
    ],
  });

export class HistorySection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.viewHistoryItem = this.viewHistoryItem.bind(this);
    }

    handleDeleteHistoryItem( ) {

    }

    viewHistoryItem(index: number) {
        console.log("blaaaaaa");
        this.props.submitCommand({
            command: 'get_history_item',
            args: {
                index: index
            }
        });
    }

    onRenderCell = (item: any, index: number): JSX.Element => {
        return (
          <div data-is-focusable>
            <div 
                className={styles.itemContent + " history-item"}
                onClick={() => this.viewHistoryItem(index)}>
                <div
                    className="codicon codicon-close codicon-button"
                    onClick={this.handleDeleteHistoryItem}
                    title={"Remove step"}
                /> {item.name}
            </div>
          </div>
        );
      };

    //TODO add the ability to click on list items to view their history
    //TODO add the ability to X and delete list items
    render() {
        return (
            <div className="slice-control-row slice-form-container" style={{ marginLeft: 0, paddingBottom: '20px' }}>
                <div style={{ display: "block", margin: "auto" }}>
                    <summary className="slice-summary">
                        <span className="slice-summary-detail" style={{ margin: "auto" }}>{'HISTORY'}</span>
                    </summary>
                    <div className={styles.container} data-is-scrollable>
                        <List
                            items={this.props.historyList}
                            style={{ }}
                            className="historyList"
                            onRenderCell={this.onRenderCell}
                        />
                    </div>
                </div>
            </div>
        );
    }
}
