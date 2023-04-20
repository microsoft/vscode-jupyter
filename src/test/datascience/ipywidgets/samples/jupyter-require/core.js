/**
 * Jupyter require core module
 *
 * @module
 * @summary     Require
 * @description Jupyter library and magic extension for managing linked JavaScript and CSS scripts and styles.
 * @version     0.1.0
 * @file        require/core.js
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


define( [
    'underscore',
    'base/js/namespace',
    'base/js/events',
    'notebook/js/codecell',
    'services/kernels/comm',
    './logger',
    './display'
], function ( _, Jupyter, events, codecell, comms, Logger, display ) {
    'use strict';

    const log = Logger()

    let CodeCell = codecell.CodeCell
    let Notebook = Jupyter.Notebook;

    let comm_manager;
    let comm;

    const get_callbacks = CodeCell.prototype.get_callbacks


    let _init_comm_manager = function ( kernel ) {
        // define in the outer scope
        comm_manager = kernel.comm_manager;
        comm = new comms.Comm( 'communicate', `communicate.JupyterRequire#${ _.now() }` );

        comm_manager.register_comm( comm );
    };

    if ( Jupyter.notebook.kernel ) {
        _init_comm_manager( Jupyter.notebook.kernel );
    } else {
        // kernel is not ready yet
        events.one( 'kernel_created.Session', ( e, d ) => _init_comm_manager( d.kernel ) );
    }

    CodeCell.prototype.get_callbacks = function () {
        const callbacks = get_callbacks.apply( this, arguments );

        const cell = this;
        const iopub_callback = callbacks.iopub.output;
        const shell_callback = callbacks.shell.reply;

        callbacks.iopub.output = function ( msg ) {

            if (
                ( _.includes( [ 'error', 'execute_result' ], msg.msg_type ) ) &&
                ( msg.parent_header.msg_id === cell.last_msg_id )
            ) {
                cell.running = false;
            }

            return iopub_callback( msg );
        };

        callbacks.shell.reply = function ( msg ) {

            if (
                ( _.includes( [ 'execute_reply' ], msg.msg_type ) ) &&
                ( msg.parent_header.msg_id === cell.last_msg_id )
            ) {
                cell.running = false;
            }

            return shell_callback( msg );
        };

        return callbacks;
    }

    /**
     * Get running cells
     */
    Notebook.prototype.get_running_cells = function () {
        let cells = this.get_cells();

        return cells.filter( ( c ) => c.running );
    };

    /**
     * Get running cell indices
     */
    Notebook.prototype.get_running_cells_indices = function () {
        let cells = this.get_cells();

        return cells.filter( ( c ) => c.running ).map( ( c, i ) => i );
    };


    /**
     * Get currently executed cell
     *
     * @returns {CodeCell}
     */
    Notebook.prototype.get_executed_cell = function () {
        let cell = Jupyter.notebook.get_running_cells()[ 0 ];

        if ( !cell ) {
            // fallback, may select wrong cell but better than die out
            let selected_cell = Jupyter.notebook.get_selected_cell();
            let prev_cell = Jupyter.notebook.get_prev_cell( selected_cell );

            cell = selected_cell.cell_type === 'code' ? selected_cell : prev_cell;
        }

        return cell;
    }

    /**
     * Get notebook requireJS config
     *
     * @returns {Object} - requirejs configuration object
     */
    function get_notebook_config() { return Jupyter.notebook.metadata.require || {}; }

    /**
     * Set notebook requireJS config
     *
     * @param config {Object} - requirejs configuration object
     */
    function set_notebook_config( config ) { Jupyter.notebook.metadata.require = config; }


    /**
     * Get cell requirement metadata
     *
     * @param cell {CodeCell} - notebook cell
     */
    function get_cell_requirements( cell ) { return cell.metadata.require || []; }


    /**
     * Set cell requirement metadata
     *
     * @param cell {CodeCell} - notebook cell to update metadata
     * @param required {Object} - requirements config object
     */
    function set_cell_requirements( cell, required ) { cell.metadata.require = required; }


    /**
     *  Check cell requirements
     * @param required {Array} - array of requirements
     * @returns {Array}
     */
    function check_requirements( required ) {
        log.debug( "Checking required libraries: ", required );

        let defined = [];  // array of promises

        required.forEach( ( lib ) => {

            let p = new Promise( ( resolve, reject ) => {

                let iid, tid;

                let callback = function () {
                    clearTimeout( tid );
                    clearInterval( iid );

                    resolve( `${ lib }: Success.` );
                };
                let errback = function () {
                    clearInterval( iid );

                    reject( new Error( `${ lib }: Timeout. Library '${ lib }' is not loaded.` ) );
                };

                tid = setTimeout( errback, 10000 );
                iid = setInterval( () => require( [ lib ], callback ), 250 );

            } );

            defined.push( p );
        } );

        return defined;
    }

    /**
     * Handle error and output it to the notebook cell
     * @param error
     * @param silent {boolean}
     */
    function handle_error( error, silent = false ) {
        log.error( error );

        if ( silent ) return

        let json = 'JupyterRequireError:\n' + JSON.stringify( error, null, 4 );
        let traceback = error.stack ? error.stack.split( '\n' ) : json.split( '\n' );

        const output_error = {
            ename: 'JupyterRequireError',
            evalue: error.message || json,
            traceback: traceback,
            output_type: 'error'
        };
        let cell = Jupyter.notebook.get_executed_cell();

        // append stack trace to the cell output element
        cell.output_area.append_output( output_error );
    }

    /**
     * Load required libraries
     *
     * This function pauses execution of Jupyter kernel
     * until require libraries are loaded
     *
     * @param config {Object}  - requirejs configuration object
     */
    async function load_required_libraries( config ) {
        log.debug( 'Require config: ', config );

        let libs = config.paths;

        if ( $.isEmptyObject( libs ) ) {
            return Promise.resolve( "No libraries to load." );
        }

        log.log( "Loading required libraries:", libs );

        require.config( config );

        log.log( "Linking required libraries:", libs );

        let defined = check_requirements( Object.keys( libs ) );

        return await Promise.all( defined ).then(
            ( values ) => {
                log.log( 'Success: ', values );
                events.trigger( 'config.JupyterRequire', { config: config } );
            } ).catch( handle_error );
    }

    /**
     * Asynchronous Function constructor
     */
    let AsyncFunction = Object.getPrototypeOf( async function () { } ).constructor;

    /**
     * Execute the function as safe script
     *
     * Safe scripts are executed on cell creation
     * and are therefore not allowed to have any requirements.
     * Scripts executed with this method also persist through notebook
     * reloads and are automatically loaded on app initialization.
    
     * This function is convenient for automatic loading and linking
     * of custom CSS and JS files.
     *
     * @param script {Function} - expression to execute
     * @param output_area {OutputArea} - current code cell's output area
     * @returns {Promise<any>}
     */
    let safe_execute = function ( script, output_area ) {
        return new Promise( ( resolve, reject ) => {
            const json = new display.DisplayData( script );

            let n_outputs = output_area.outputs.length;

            // safe script can use the native evaluation
            output_area.append_output( json );

            // a little hack since OutputArea.prototype.append_output
            // does not return promise
            let t = setInterval( () => {
                if ( output_area.outputs.length > n_outputs ) resolve();
            }, 50 );

            setTimeout( () => {
                clearInterval( t ); reject( new Error( "Script execution timeout." ) );
            }, 5000 );
        } );
    };

    /**
     * Execute function with requirements in an output_area context
     *
     * @param func {Function} - expression to execute
     * @param required {Array} - required libraries
     * @param silent {boolean} - whether the script should be executed in the silent mode
     * @param output_area {OutputArea} - current code cell's output area
     * @returns {Promise<any>}
     */
    let execute_with_requirements = function ( func, required, silent, context, output_area ) {
        return new Promise( async ( resolve, reject ) => {
            let element = silent ? undefined : display.create_output_subarea( output_area );

            try {
                requirejs( required, ( ...args ) => {
                    func.apply( output_area, [ ...args, element, context ] )
                        .then( () => {
                            resolve( element );
                        } ).catch( reject );
                } );
            } catch ( err ) {
                // catch any exception thrown by RequireJS (like "Mismatched anonymous define() module")
                // to avoid deadlocking the interpreter
                reject( err );
            }
            setTimeout( reject, 5000, new Error( "Script execution timeout." ) );
        } );
    };

    /**
     * Wrap and Execute JS script in output_area context
     *
     * This function pauses execution of Jupyter kernel
     * until required libraries are loaded
     *
     * @returns {Function} - wrapped execution partial function
     */
    let execute_script = async function ( script, required, params, silent = false ) {

        // get rid of invalid characters
        params = params
            .map( ( p ) => p.replace( /[|&$%@"<>()+-.,;]/g, "" ) )
            .filter( ( d ) => d.trim().length );
        // expose element to the user script
        params.push( 'element' );

        const context = silent ? {} : {
            cell: this,  // current CodeCell
            output_area: this.output_area
        }
        params.push( 'context' )

        try {
            let wrapped = new AsyncFunction( ...params, script.toString() );
            let execute = _.partial( execute_with_requirements, wrapped, required, silent, context );

            await Promise.all( check_requirements( required ) )
                .then( async ( r ) => {
                    log.debug( r );
                    if ( !silent ) {
                        await display.append_javascript( execute, context.output_area, context ).then(
                            ( r ) => log.debug( "Output appended.", r )
                        );
                        events.trigger( 'require.JupyterRequire', { cell: this, require: required, context: context } );
                    } else {
                        await execute()
                    }
                } )
                .catch( handle_error );
        } catch ( err ) {
            // This error occurs mainly when user provides invalid script
            // when wrapping to an AsyncFunction
            handle_error( err, silent );  // handle to append it to the cell output
        }
    };

    /**
     * Register comms for messages from Python kernel
     *
     */
    let register_targets = function () {
        let _execute = new Promise( ( resolve ) => {
            comm_manager.register_target( 'execute',
                ( comm, msg ) => {
                    log.debug( 'Comm: ', comm, 'initial message: ', msg );

                    comm.on_msg( async ( msg ) => {
                        log.debug( 'Comm: ', comm, 'message: ', msg );

                        // get running cell or fall back to current cell
                        let cell = Jupyter.notebook.get_executed_cell();

                        const d = msg.content.data;
                        return await execute_script.call( cell, d.script, d.require, d.parameters, d.silent );
                    } );
                }
            );

            resolve( `Comm 'execute' registered.` );
        } );

        let _safe_execute = new Promise( ( resolve ) => {
            comm_manager.register_target( 'safe_execute',
                ( comm, msg ) => {
                    log.debug( 'Comm: ', comm, 'initial message: ', msg );

                    comm.on_msg( async ( msg ) => {
                        log.debug( 'Comm: ', comm, 'message: ', msg );

                        // get running cell or fall back to current cell
                        let cell = Jupyter.notebook.get_executed_cell();
                        let output_area = cell.output_area;

                        const script = msg.content.data.script;

                        log.debug( "Executing safe script: ", script );

                        return await safe_execute( script, output_area )
                            .then( () => log.debug( "Success." ) )
                            .catch( handle_error );
                    } );

                }
            );

            resolve( `Comm 'safe_execute' registered.` );
        } );

        let _config = new Promise( ( resolve ) => {
            comm_manager.register_target( 'config',
                ( comm, msg ) => {
                    log.debug( 'Comm: ', comm, 'initial message: ', msg );

                    comm.on_msg( async ( msg ) => {
                        log.debug( 'Comm: ', comm, 'message: ', msg );
                        return await load_required_libraries( msg.content.data )
                            .then( ( values ) => log.debug( values ) )
                            .catch( log.error );
                    } );

                } );

            resolve( `Comm 'config' registered.` );
        } );

        return Promise.all( [ _execute, _safe_execute, _config ] )
            .then( ( r ) => {
                events.trigger(
                    'comms_registered.JupyterRequire', { timestamp: _.now() } );

                return r;
            } );
    };

    /**
     * Communicate events to Jupyter Require kernel
     *
     */
    let communicate = function ( evt, data ) {
        log.debug( "Communication requested by event: ", evt );

        if ( _.isUndefined( comm ) ) {
            log.warn(
                "Communication comm has not been initialized yet. " +
                "Is the kernel ready? Interrupting..." );
            return;
        }

        const event = _.pick( evt, 'data', 'namespace', 'timeStamp', 'type' );

        comm.open( { 'event_type': evt.type } );
        let p = new Promise( ( resolve, reject ) => {
            log.debug( "Sending event to kernel.", event, data );

            comm.send( { event: event, event_data: data } );
            comm.on_msg( ( r ) => {
                log.debug( "Kernel response received: ", r );
                resolve();
            } );

            setTimeout( reject, 5000, new Error( "Script execution timeout." ) );
        } );

        return p.then( comm.close ).catch( ( err ) => {
            comm.close();
            throw err instanceof Error ? err : new Error( err );
        } );
    };



    return {
        AsyncFunction: AsyncFunction,

        communicate: communicate,

        get_cell_requirements: get_cell_requirements,
        set_cell_requirements: set_cell_requirements,

        get_notebook_config: get_notebook_config,
        set_notebook_config: set_notebook_config,

        check_requirements: check_requirements,

        execute_script: execute_script,
        execute_with_requirements: execute_with_requirements,
        safe_execute: safe_execute,

        load_required_libraries: load_required_libraries,

        register_targets: register_targets,
    };

} );
