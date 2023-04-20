/**
 * Jupyter require display module
 *
 * @module
 * @summary     Require
 * @description Jupyter library and magic extension for managing linked JavaScript and CSS scripts and styles.
 * @version     0.1.0
 * @file        require/display.js
 * @author      Marek Cermak
 * @contact     macermak@redhat.com
 * @copyright   Copyright 2019 Marek Cermak <macermak@redhat.com>
 *
 * This source file is free software, available under the following license:
 *   MIT license
 *
 * This source file is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the license files for details.
 *
 * For details please refer to: https://github.com/CermakM/jupyter-require
 */


define(['underscore'], function(_) {

    // mime types
    const MIME_JAVASCRIPT = 'application/javascript';
    const MIME_HTML = 'text/html';
    const MIME_TEXT = 'text/plain';

    const mime_types = {
        MIME_JAVASCRIPT: MIME_JAVASCRIPT,
        MIME_HTML: MIME_HTML,
        MIME_TEXT: MIME_TEXT,
    };

    /**
     * Object storing output display data and metadata
     *
     * @param js {Function} - function to be executed in cell context or safe script
     * @param html {Element} - DOM element to be appended
     * @returns {Object}
     */
    function DisplayData(js, html) {
        this.data = {};
        this.metadata = {};
        this.output_type = 'display_data';

        if (_.isString(js)) {
            // treated as safe script
            this.data[MIME_JAVASCRIPT] = js;
            this.data[MIME_TEXT] = "<JupyterRequire.display.SafeScript object>";

            this.metadata.finalized = true;

        } else {

            this.metadata.display = {
                element: html,
            };
            this.metadata.execute = js;

            this.metadata.finalized = false;

            this.metadata.frozen = false;
            this.metadata.frozen_output = undefined;

        }
    }

    /**
     * Freeze the output and store it in the data
     *
     * The data object can be then be serialized into JSON and persists
     * after notebook is saved.
     *
     */
    DisplayData.prototype.freeze_output = function() {
        let frozen_output = {};

        let display = this.metadata.display;
        if (display === undefined || this.metadata.finalized)
            return;

        let elt = display.element;
        if (_.isElement(elt.get(0))) {
            let html = $(elt).addClass('output_frozen').html();
            if (html.length > 0)
                frozen_output = {
                    [MIME_HTML]: html,
                    [MIME_TEXT]: "<JupyterRequire.display.FrozenOutput object>",
                }
        }

        this.metadata.frozen = true;
        this.metadata.frozen_output = frozen_output;
    };

    /**
     * Finalize the output
     *
     * The cell can no longer interact with JupyterRequire after
     * the output has been finalized. This is both safety measure
     * and convenience for storing the notebook.
     *
     * This function is triggered before notebook shutdown.
     *
     */
    DisplayData.prototype.finalize_output = function() {
        if (this.metadata.finalized) return;

        if (this.metadata.frozen !== true)
            this.freeze_output();

        this.data = this.metadata.frozen_output;
        this.metadata = {
            frozen: true,
            finalized: true,
        };
    };


    let create_output_subarea = function(output_area, toinsert) {
        if (toinsert === undefined) {
            toinsert = output_area.create_output_subarea(
                {}, "output_javascript rendered_html", MIME_JAVASCRIPT);
        }

        output_area.keyboard_manager.register_events(toinsert);

        // preset width for user's comfort
        // dry-run append to get the current output-area width
        let output = output_area.create_output_area();

        output.append(toinsert);
        output_area.element.append(output);

        toinsert.css('width', toinsert.width());

        // clean up
        output_area.element.empty();

        return toinsert;
    };

    let append_javascript = async function(js, output_area, context) {
        let toinsert = await js(output_area, context);
        let display_data = append_display_data(js, toinsert, output_area);

        return append_output(MIME_JAVASCRIPT, display_data, toinsert, output_area);
    };

    let append_output = function(type, display_data, toinsert, output_area) {
        return new Promise((resolve) => {
            let md = display_data.md;

            let output = output_area.create_output_area();
            output.append(toinsert);

            output_area.element.append(output);
            output_area.events.trigger('output_appended.OutputArea', [type, display_data, md, toinsert]);

            resolve({output_area: output_area, output: display_data});
        });
    };

    let append_display_data = function(js, html, output_area){
        let display_data = new DisplayData(js, html);

        output_area.outputs.push(display_data);

        output_area.events.trigger('output_added.OutputArea', {
            output_area: output_area,
            output: display_data
        });

        return display_data;
    };

    let freeze_cell_outputs = function(cell) {
        return new Promise((resolve) => {
            if (cell.cell_type !== 'code') resolve();

            let outputs = cell.output_area.outputs;

            outputs.forEach((output) => {
                if (output instanceof DisplayData)
                    output.freeze_output();
            });

            resolve();
        })
    };

    let finalize_cell_outputs = function(cell) {
        return new Promise((resolve) => {
            if (cell.cell_type !== 'code') resolve();

            let outputs = cell.output_area.outputs;

            outputs.forEach((output) => {
                if (output instanceof DisplayData) {
                    output.freeze_output();
                    output.finalize_output();
                }
            });

            // get rid of empty outputs, if any
            cell.output_area.outputs = outputs.filter((d) => !_.isEmpty(d.data));

            resolve();
        })
    };


    return {
        DisplayData           : DisplayData,

        mime_types            : mime_types,

        create_output_subarea : create_output_subarea,

        append_display_data   : append_display_data,
        append_javascript     : append_javascript,
        append_output         : append_output,

        freeze_cell_outputs   : freeze_cell_outputs,
        finalize_cell_outputs : finalize_cell_outputs,
    }
});
