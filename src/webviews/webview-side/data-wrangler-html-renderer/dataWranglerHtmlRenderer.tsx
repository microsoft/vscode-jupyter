import * as React from "react";
import type { RendererContext, OutputItem, RendererApi } from "vscode-notebook-renderer";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { TableComputedIcon } from "@fluentui/react-icons-mdl2";
import { IDataWranglerHtmlRendererContextState } from "./types";

if (!String.prototype.format) {
    String.prototype.format = function (this: string) {
        const args = arguments;
        return this.replace(/{(\d+)}/g, (match, number) => (args[number] === undefined ? match : args[number]));
    };
}

interface IDataWranglerHtmlRendererProps {
    outputItem: OutputItem;
    context: RendererContext<IDataWranglerHtmlRendererContextState>;
    getLocalizedStrings: () => {
        ['DataScience.launchDataWrangler']: string;
        ['DataScience.dataWranglerVariableWasLost']: string;
    };
    defaultRenderer?: RendererApi;
}

interface IDataWranglerHtmlRendererState {
    isDataFrame: boolean;
    lostVariableName?: string;
    htmlToRender?: string;
}

/**
 * Sanity check that the content is actually HTML.
 */
function isHTML(str: string) {
    var doc = new DOMParser().parseFromString(str, "text/html");
    return Array.from(doc.body.childNodes).some((node) => node.nodeType === 1);
}

async function isPandasDataFrame(id: string, value: string, context: RendererContext<IDataWranglerHtmlRendererContextState>): Promise<boolean> {
    // if we don't have postMessage defined, then we shouldn't ever be able to render the launch button
    const postMessage = context.postMessage;
    if (!postMessage) {
        return false;
    }
    return new Promise((resolve) => {
        // this should generally be true, but it's possible that people could be calling
        // manual render calls
        if (!isHTML(value)) {
            resolve(false);
        }

        // for the initial check, we make sure that this output looks like pandas HTML rendering, see https://github.com/pandas-dev/pandas/blob/main/pandas/io/formats/html.py#L607
        if (!value.includes("<table") || !value.includes("<style scoped>") || !value.includes('class="dataframe"')) {
            resolve(false);
        }

        // wait for a response from the host for additional confirmation
        const listener = context.onDidReceiveMessage?.((e) => {
            if (e.type === "shouldShowLaunchButtonResponse") {
                listener?.dispose();
                resolve(e.payload === true);
            }
        });

        // post the query to the host for additional checking
        postMessage({
            outputId: id,
            type: "shouldShowLaunchButton"
        });
    });
}

/**
 * Overrides the default text/html renderer.
 */
export class DataWranglerHtmlRenderer extends React.PureComponent<IDataWranglerHtmlRendererProps, IDataWranglerHtmlRendererState> {
    private containerRef = React.createRef<HTMLDivElement>();

    override state = {
        isDataFrame: false,
        lostVariableName: undefined,
        htmlToRender: undefined
    };

    override componentDidMount() {
        const { outputItem, context, defaultRenderer } = this.props;

        // when we first mount, just render using the default renderer
        const element = this.containerRef.current;
        if (element && defaultRenderer) {
            defaultRenderer.renderOutputItem(outputItem, element);
        }

        // try to get the output text, if decoding failed then just default to empty string
        let outputText = '';
        try {
            outputText = outputItem.text();
        } catch (e) {}

        // if the default renderer is somehow missing, we can still fall back to our own HTML rendering
        if (!element || !defaultRenderer) {
            this.setState({
                htmlToRender: outputText
            })
        }

        // if we ever get a message to hide the button, then we should just hide it
        context.onDidReceiveMessage?.((e) => {
            if (e.type === "variableWasLost") {
                this.setState({
                    isDataFrame: false,
                    lostVariableName: e.payload
                })
            }
        })

        // fire off a check to see if the current output is a dataframe
        void isPandasDataFrame(outputItem.id, outputText, context).then((isDataFrame) => {
            if (isDataFrame) {
                this.setState({
                    isDataFrame
                });
            }
        });
    }

    private launchInDataWrangler = () => {
        const { outputItem, context } = this.props;
        context.postMessage?.({
            outputId: outputItem.id,
            type: "launchDataWrangler"
        });
    };

    override render() {
        const { getLocalizedStrings } = this.props;
        const { isDataFrame, lostVariableName, htmlToRender } = this.state;
        const locStrings = getLocalizedStrings();
        return (
            <div>
                {lostVariableName && <p>{locStrings['DataScience.dataWranglerVariableWasLost'].format(lostVariableName)}</p>}
                {isDataFrame && (
                    <VSCodeButton className='data-wrangler-launch-button' appearance="primary" onClick={this.launchInDataWrangler}>
                        {locStrings['DataScience.launchDataWrangler']}
                        <span className='data-wrangler-launch-button-icon' slot="start">
                            <TableComputedIcon />
                        </span>
                    </VSCodeButton>
                )}
                {/* TODO@DW: add a richer table renderer here if we detect Pandas data frames */}
                <div ref={this.containerRef} dangerouslySetInnerHTML={
                   htmlToRender ? { __html: htmlToRender } : undefined
                } />
            </div>
        );
    }
}
