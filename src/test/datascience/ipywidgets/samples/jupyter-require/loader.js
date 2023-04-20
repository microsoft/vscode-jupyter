/**
 * Loader.
 *
 * Load and configure the extension.
 *
 * @link   https://github.com/CermakM/jupyter-require#readme
 * @file   This file loads the extension and configures it for usage.
 * @author Marek Cermak <macermak@redhat.com>
 * @since  0.3.2
 */

define( [
    './core',
    './display',
    './logger'
], function ( core, display, Logger ) {

    let _ = require( 'underscore' );
    let events = require( 'base/js/events' );
    let Jupyter = require( 'base/js/namespace' );

    const log = Logger()

    /**
     * Get code cells with display data
     *
     * @returns {*[]}
     */
    function get_display_cells() {
        let cells = Jupyter.notebook.get_cells();

        return cells.filter(
            ( c ) => {
                return c.cell_type === 'code' &&
                    c.output_area.outputs &&
                    c.output_area.outputs.some( d => d.output_type === 'display_data' );
            } );
    }

    /**
     * Freeze cells
     *
     * @returns {Promise<void | never>}
     */
    function freeze_cells() {
        let cells = get_display_cells();

        return Promise.all( cells.map( ( cell ) => display.freeze_cell_outputs( cell ) ) )
            .then( () => log.debug( "Successfully frozen cell outputs." ) )
            .catch( log.error );
    }

    /**
     * Finalize all cell outputs
     *
     * This function should not make any kernel related calls
     * to prevent race conditions with kernel event handlers
     * if called when kernel is interrupted or dead.
     *
     * @returns {Promise<void | never>}
     */
    function finalize_cells() {
        let cells = get_display_cells();

        events.trigger( 'before_finalize.JupyterRequire' )

        return Promise.all( cells.map( ( cell ) => display.finalize_cell_outputs( cell ) ) )
            .then( () => {
                Jupyter.notebook.metadata.finalized = {
                    trusted: Jupyter.notebook.trusted,
                    timestamp: _.now(),
                };
            } )
            .then( () => Jupyter.notebook.save_notebook() )
            .then( () => log.debug( "Successfully finalized cell outputs." ) )
            .catch( ( err ) => {
                log.error();
                events.trigger( 'notebook_save_failed.Notebook', err );
            } );

        events.trigger( 'after_finalize.JupyterRequire' )
    }


    /**
     * Register actions
     *
     */
    function register_actions() {
        const prefix = 'jupyter-require';
        const action_name = 'save-and-finalize';

        const action = {
            icon: 'fa-shield-alt',  // a font-awesome class used on buttons, etc
            help: 'Save and Finalize',
            help_index: 'fb',
            handler: async function ( env, event ) {
                await finalize_cells();  // blocking call

                if ( event ) {
                    event.preventDefault();
                }
                return false;
            },
        };

        // returns 'jupyter-require:save-and-finalize'
        const full_action_name = Jupyter.actions.register( action, action_name, prefix );

        const btn_group = Jupyter.toolbar.add_buttons_group( [ full_action_name ], prefix );

        // position after the default save button
        // NOTE: This really IS id='save-notbook'
        $( 'div#save-notbook.btn-group' )
            .after( btn_group );
    }

    /**
     * Register event handlers
     *
     */
    function register_events() {
        events.on( 'config.JupyterRequire', ( e, d ) => core.set_notebook_config( d.config ) );
        events.on( 'require.JupyterRequire', ( e, d ) => core.set_cell_requirements( d.cell, d.require ) );

        events.on( {
            'comms_registered.JupyterRequire': ( e, d ) => {
                log.debug( "Comm targets registered." );
            },

            'extension_loaded.JupyterRequire': ( e, d ) => {
                log.debug( "Extension loaded." );
            },
        } );

        events.on( 'execute.CodeCell', ( e, d ) => d.cell.running = true );
        events.on( 'finished_execute.CodeCell', ( e, d ) => d.cell.running = false );

        events.on( 'output_added.OutputArea', ( e, d ) => {
            let display_data = d.output;
            if ( display_data.output_type !== 'display_data' ) return;

            if ( display_data instanceof display.DisplayData || display_data.metadata.frozen === false ) {
                display_data.freeze_output();
            } else {
                if ( _.isFunction( display_data.metadata.execute ) )
                    display.append_javascript( display_data.metadata.execute, d.output_area ).then(
                        ( r ) => log.debug( 'Output appended: ', r )
                    );
            }


        } );

        events.on( 'before_save.Notebook', freeze_cells );

        /* Finalization events

           This is a bit hackish, but it covers probable scenarios
           in which finalization is needed, like app close/reload and
           session closed and halt.
        */
        events.on( {
            'kernel_dead.Session': async function () {
                log.debug( "Session is dead. Finalizing outputs..." );
                await finalize_cells();
            },

            'kernel_killed.Session': async function () {
                log.debug( "Session closed. Finalizing outputs..." );
                await finalize_cells();
            },

            'kernel_dead.Kernel': async function () {
                log.debug( "Kernel is dead. Finalizing outputs..." );
                await finalize_cells();
            },
        } );
    }

    /**
     * Initialize requirements in existing cells
     *
     */
    function init_existing_cells() {
        let cells = get_display_cells();

        cells.forEach( async ( cell ) => {
            // mark frozen outputs
            let outputs = cell.output_area.outputs;

            outputs.forEach( ( output ) => {
                if ( output.metadata === undefined )
                    return;
                if ( output.metadata.frozen === true ) {
                    let element = $( output.element ).find( '.output_subarea' );

                    // convenience for user
                    element.addClass( 'output_frozen' );
                }
            } );

            // check requirements
            let required = core.get_cell_requirements( cell );

            if ( required.length > 0 ) {
                Promise.all( core.check_requirements( required ) )
                    .then( ( libs ) => {
                        log.debug( "Success:", libs );
                    } ).catch( ( r ) => new Error( r ) );
            }

        } );
    }

    /**
     * Link CSS
     *
     * @param url {String} - full url to the CSS file
     * @param attrs {Object} - additional attributes, like integrity etc.
     *
     */
    function link_css( url, attrs ) {
        let link = document.createElement( "link" );

        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = url;

        Object.assign( link, attrs );

        document.getElementsByTagName( "head" )[ 0 ].appendChild( link );
    }


    /**
     * Load extension
     *
     */
    return function load_extension( { reload = false } = {} ) {
        return new Promise( ( resolve ) => {

            const config = core.get_notebook_config();

            if ( !reload ) {
                register_events();

                const fas_url = "https://use.fontawesome.com/releases/v5.8.1/css/all.css";
                link_css( fas_url, {
                    integrity: "sha384-50oBUHEmvpQ+1lW4y57PTFmhCaXp0ML5d60M1M7uH2+nqUivzIebhndOJK28anvf",
                    crossOrigin: "anonymous"
                } );

                register_actions();
            }

            core.register_targets()
                .then( log.debug );

            if ( config !== undefined ) {
                core.load_required_libraries( config )
                    .then( () => init_existing_cells() )
                    .then( () => {
                        resolve();
                    } )
                    .catch( log.error );
            }

        } );
    }
} )