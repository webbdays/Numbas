/*
Copyright 2011-14 Newcastle University
   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at
       http://www.apache.org/licenses/LICENSE-2.0
   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
/** @file Contains code to load in the other script files, and initialise the exam.
 *
 * Creates the global {@link Numbas} object, inside which everything else is stored, so as not to conflict with anything else that might be running in the page.
 */
(function() {
    if(typeof window=='undefined') {
        if(typeof global!=='undefined') {
            window = global.window = global;
            global.alert = function(m) { console.error(m); }
        }
    }
    if(!window.Numbas) { window.Numbas = {} }
    if(typeof global!=='undefined') {
        global.Numbas = window.Numbas;
    }
/** @namespace Numbas */
/** Extensions should add objects to this so they can be accessed */
Numbas.extensions = {};
/** A function for displaying debug info in the console. It will try to give a reference back to the line that called it, if it can.
 *
 * @param {string} msg - Text to display.
 * @param {boolean} [noStack=false] - Don't show the stack trace.
 * @param {Error} error
 */
Numbas.debug = function(msg,noStack,error)
{
    if(window.console)
    {
        var e = new Error(msg);
        if(e.stack && !noStack)
        {
            var words= e.stack.split('\n')[2];
            if(error) {
                console.error(msg,error);
            } else {
                console.error(msg," "+words);
            }
        }
        else
        {
            console.log(msg);
        }
    }
};
/** Display an error in a nice alert box. Also sends the error to the console via {@link Numbas.debug}.
 *
 * @param {Error} e
 */
Numbas.showError = function(e)
{
    var message = (e || e.message)+'';
    message += ' <br> ' + e.stack.replace(/\n/g,'<br>\n');
    Numbas.debug(message,false,e);
    Numbas.display && Numbas.display.showAlert(message);
    throw(e);
};
/** Generic error class. Extends JavaScript's `Error`.
 *
 * @class
 * @param {string} message - A description of the error. Localised by R.js.
 * @param {object} args - Arguments for the error message.
 * @param {Error} originalError - If this is a re-thrown error, the original error object.
 */
Numbas.Error = function(message, args, originalError)
{
    var e = new Error();
    e.name = "Numbas Error";
    e.message = R.apply(e,[message,args]);
    e.originalMessage = message;
    e.originalMessages = [message];
    if(originalError!==undefined) {
        e.originalError = originalError;
        if(originalError.originalMessages) {
            e.originalMessages = e.originalMessages.concat(originalError.originalMessages.filter(function(m){return m!=message}));
        }
    }
    return e;
}

var scriptreqs = {};
/** Keep track of loading status of a script and its dependencies.
 *
 * @param {string} file - Name of the script.
 * @param {Array.<string>} fdeps - Scripts which this one depends on.
 * @param {Function} callback
 * @global
 * @class
 * @property {string} file - Name of the script.
 * @property {boolean} loaded - Has the script been loaded yet?
 * @property {boolean} executed - Has the script been run?
 * @property {Array.<string>} backdeps - Scripts which depend on this one (need this one to run first)
 * @property {Array.<string>} fdeps - Scripts which this one depends on (it must run after them)
 * @property {Function} callback - The function to run when all this script's dependencies have run (this is the script itself)
 */
var RequireScript = Numbas.RequireScript = function(file,fdeps,callback)
{
    this.file = file;
    scriptreqs[file] = this;
    this.backdeps = [];
    this.fdeps = fdeps || [];
    this.callback = callback;
}
RequireScript.prototype = {
    loaded: false,
    executed: false,
    backdeps: [],
    fdeps: [],
    callback: null,

    
    /** Try to run this script. It will run if all of its dependencies have run.
     * Once it has run, every script which depends on it will try to run.
     */
    tryRun: function() {
        if(this.loaded && !this.executed) {
            var dependencies_executed = this.fdeps.every(function(r){ return scriptreqs[r].executed; });
            if(dependencies_executed) {
                if(this.callback) {
                    var module = { exports: {} };
                    this.callback.apply(window,[module]);
                    for(var x in module.exports) {
                        window[x] = module.exports[x];
                        if(typeof global!=='undefined') {
                            global[x] = module.exports[x];
                        }
                    }
                }
                this.executed = true;
                this.backdeps.forEach(function(r) {
                    scriptreqs[r].tryRun();
                });
            }
        }
    }
};
/** Ask to load a javascript file. Unless `noreq` is set, the file's code must be wrapped in a call to Numbas.queueScript with its filename as the first parameter.
 *
 * @memberof Numbas
 * @param {string} file
 * @param {boolean} noreq - Don't create a {@link Numbas.RequireScript} object.
 * @returns {Numbas.RequireScript}
 */
var loadScript = Numbas.loadScript = function(file,noreq)
{
    if(!noreq)
    {
        if(scriptreqs[file]!==undefined)
            return scriptreqs[file];
        var req = new RequireScript(file);
        return req;
    }
    return scriptreqs[file];
}
/**
 * Queue up a file's code to be executed.
 * Each script should be wrapped in this function.
 *
 * @param {string} file - Name of the script.
 * @param {Array.<string>} deps - A list of other scripts which need to be run before this one can be run.
 * @param {Function} callback - A function wrapping up this file's code.
 */
Numbas.queueScript = function(file, deps, callback) {
    if(typeof(deps)=='string')
        deps = [deps];
    for(var i=0;i<deps.length;i++)
    {
        var dep = deps[i];
        deps[i] = dep;
        loadScript(dep);
        scriptreqs[dep].backdeps.push(file);
    }

    var req = scriptreqs[file];
    if(req) {
        req.fdeps = deps;
        req.callback = callback;
    } else {
        req = new RequireScript(file,deps,callback);
    }
    req.loaded = true;
    Numbas.tryInit();
}
/** Called when all files have been requested, will try to execute all queued code if all script files have been loaded. */
Numbas.tryInit = function()
{
    if(Numbas.dead) {
        return;
    }
    //put all scripts in a list and go through evaluating the ones that can be evaluated, until everything has been evaluated
    var stack = [];
    for(var x in scriptreqs)
    {
        try {
            scriptreqs[x].tryRun();
        } catch(e) {
            alert(e+'');
            console.error(e);
            Numbas.dead = true;
            return;
        }
    }
}

Numbas.runImmediately = function(deps,fn) {
    Numbas.queueScript('base',[], function() {});
    var missing_dependencies = deps.filter(function(r) {
        if(!scriptreqs[r]) {
            return true;
        } else if(!scriptreqs[r].loaded) {
            return true;
        } else if(!scriptreqs[r].executed) {
            return true;
        }
    });
    if(missing_dependencies.length) {
        console.log(deps.filter(function(r){return scriptreqs[r] ? scriptreqs[r].executed : true}));
        throw(new Error("Can't run because the following dependencies have not run: "+missing_dependencies.join(', ')));
    }
    fn();
}

/** A wrapper round {@link Numbas.queueScript} to register extensions easily.
 * The extension is not run immediately - call {@link Numbas.activateExtension} to run the extension.
 *
 * @param {string} name - Unique name of the extension.
 * @param {Array.<string>} deps - A list of other scripts which need to be run before this one can be run.
 * @param {Function} callback - Code to set up the extension. It's given the object `Numbas.extensions.<name>` as a parameter, which contains a {@link Numbas.jme.Scope} object.
 */
var extension_callbacks = {};
Numbas.addExtension = function(name,deps,callback) {
    deps.push('jme');
    Numbas.queueScript('extensions/'+name+'/'+name+'.js',deps,function() {
        var extension = Numbas.extensions[name] = {
            scope: new Numbas.jme.Scope()
        };
        extension_callbacks[name] = {
            callback: callback,
            extension: extension,
            activated: false
        }
    });
}

/** Run the extension with the given name. The extension must have already been registered with {@link Numbas.addExtension}.
 *
 * @param {string} name
 */
Numbas.activateExtension = function(name) {
    var cb = extension_callbacks[name];
    if(!cb) {
        throw(new Numbas.Error("extension.not found",{name: name}));
    }
    if(!cb.activated) {
        cb.callback(cb.extension);
        cb.activated = true;
    }
}

/** Check all required scripts have executed - the theme should call this once the document has loaded.
 * 
 * @returns {Array.<object>} A list of files which have not loaded.
 */
Numbas.checkAllScriptsLoaded = function() {
    var fails = [];
    for(var file in scriptreqs) {
        var req = scriptreqs[file];
        if(req.executed) {
            continue;
        }
        if(req.fdeps.every(function(f){return scriptreqs[f].executed})) {
            var err = new Numbas.Error('die.script not loaded',{file:req.file});
            Numbas.display && Numbas.display.die(err);
        }
        fails.push({file: req.file, req: req, fdeps: req.fdeps.filter(function(f){return !scriptreqs[f].executed})});
    };
    return fails;
}
})();

/** Resources to do with localisation: `preferred_locale` is the code of the locale to use, and `resources` is a dictionary of localisations.
 *
 * @name locale
 * @memberof Numbas
 * @type {object}
 */

/** Definitions of marking scripts for the built-in part types.
 *
 * @name raw_marking_scripts
 * @memberof Numbas
 * @type {object.<string>}
 */

/** Marking scripts for the built-in part types.
 *
 * @name marking_scripts
 * @memberof Numbas
 * @type {object.<Numbas.marking.MarkingScript>}
 */
