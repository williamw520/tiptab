/*
  Tip Tab
  A Firefox extension to manage and navigate the browser tabs.
  Copyright (C) 2018-2023  William Wong (williamw520@gmail.com)

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/


// ES6 imports
import logger from "/scripts/util/logger.js";
import appcfg from "/scripts/util/appcfg.js";


// app module
let the_module = (function() {
    "use strict";

    const module = { NAME: "app" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);

    let app = module;
    let SP = String.prototype;
    let AP = Array.prototype;
    let OP = Object.prototype;

    // util
    app.noop        = () => {};
    app.identity    = (obj) => obj;
    app.json        = function(obj)         { return JSON.stringify(obj, null, 4) };
    app.has         = function(obj, key)    { return obj != null && obj.hasOwnProperty(key) };
    app.isDef       = function(val)         { return typeof val !== "undefined" };
    app.isStr       = function(obj)         { return (typeof obj == "string" || obj instanceof String) };
    app.isArray     = Array.isArray || function(obj) { return OP.toString.call(obj) === "[object Array]" };
    app.isFn        = function(obj)         { return typeof obj === "function" };
    app.isObj       = function(obj)         { return typeof obj === "object" };
    app.isNum       = function(obj)         { return typeof obj === "number" };
    app.isDate      = function(obj)         { return obj instanceof Date || OP.toString.call(obj) === "[object Date]" };
    app.alert       = function()            { alert(app.dump(Array.prototype.slice.call(arguments))) };
    app.log         = function()            { console.log(app.dump(Array.prototype.slice.call(arguments))) };
    app.ensureFn    = function(orgFn, defFn){ return app.isFn(orgFn) ? orgFn : defFn };
    app.defval      = function(val, dfVal)  { return typeof val === "undefined" ? dfVal : val }  // return default only if val undefined.  Return 0 or null correctly.
    app.ensureVal   = function(val, dfVal)  { return typeof val === "undefined" || val == null ? dfVal : val } // return default if val is undefined or null.
    app.defObjVal   = function(o, k, dfVal) { return app.has(o, k) ? app.ensureVal(o[k], dfVal) : dfVal };     // return default if val is undefined or null.
    app.setObjVal   = function(o, k, val)   { o[k] = val; return o }
    app.defer       = function(obj, fn)     { let args = AP.slice.call(arguments, 2); setTimeout(function() { fn.apply(obj, args) }, 0); };
    app.boolVal     = function(o, k)        { return app.has(o, k) ? o[k] : false }
    app.asArray     = function()            { return [].slice.call(arguments) }

    // enhance String
    if (typeof SP.ltrim != "function")      SP.ltrim = function() { return this.replace(/^\s+/,'') };
    if (typeof SP.rtrim != "function")      SP.rtrim = function() { return this.replace(/\s+$/,'') };
    if (typeof SP.startsWith != "function") SP.startsWith = function(prefix) { return this.lastIndexOf(prefix, 0) === 0 };
    if (typeof SP.endsWith != "function")   SP.endsWith = function(suffix) { return this.indexOf(suffix, this.length - suffix.length) !== -1 };
    if (typeof SP.toNum != "function")      SP.toNum = function(defv) { let num = parseFloat(this); return isNaN(num) ? (defv ? defv : 0) : num; };
    if (typeof SP.indexOfRx != "function")  SP.indexOfRx = function(regex, startPos) {
        let indexOf = this.substring(startPos || 0).search(regex);
        return (indexOf >= 0) ? (indexOf + (startPos || 0)) : indexOf;
    }

    // enhance Array
    if (typeof AP.first != "function")      AP.first    = function() { return this.length > 0 ? this[0] : null };
    if (typeof AP.second != "function")     AP.second   = function() { return this.length > 1 ? this[1] : null };
    if (typeof AP.third != "function")      AP.third    = function() { return this.length > 2 ? this[2] : null };
    if (typeof AP.last != "function")       AP.last     = function() { return this.length > 0 ? this[this.length - 1] : null };
    if (typeof AP.popUntil != "function")   AP.popUntil = function(x){ this.length = this.lastIndexOf(x) + 1; return this };

    app.arrayMove   = function(array, from, to) { array.splice(to, 0, array.splice(from, 1)[0]); return array };
    app.flatten     = function(array)           { return [].concat.apply([], array) };
    app.addAt       = function(array, obj, i)   { if (i > -1) { array.splice(i, 0, obj) } else { array.push(obj) } }        // append at end for i < -1
    app.addAfter    = function(array, obj, i)   { if (i > -1) { array.splice(i + 1, 0, obj) } else { array.push(obj) } }
    app.arrayUnique = function(array) {
        let seen = new Set();
        return array.reduce( (array, x) => {
            if (!seen.has(x)) {
                seen.add(x);
                array.push(x);  // preserve the original order of the array.
            }
            return array;
        }, []);
    }
    app.promiseSeq  = function(promises) {
        return promises.reduce( (promiseChain, currentPromise) => {
            return promiseChain.then( resultsOut => {
                return currentPromise.then( currentResult => [ ...resultsOut, currentResult ] )
            })
        }, Promise.resolve([]));    // initial promiseChain with initial empty result array.
    }

    app.debounce = function(operationFunc, waitMS, resetWaitTime, context) {
        let timeoutId = null;
        let operationArgs = null;           // closure share variable to pass the arguments of the operationProxy.
        let onTimeoutCallback = function() {
            timeoutId = null;
            operationFunc.apply(context, operationArgs);
        }
        let operationProxy = function() {   // the operationProxy can be called repeatedly, and only the last one goes through.
            operationArgs = arguments;      // parameters of the last called proxy operation are passed to operationFunc.
            if (resetWaitTime && !timeoutId) {
                clearTimeout(timeoutId);    // reset the timer every time operationProxy is called to wait for the full waitMS again.
                timeoutId = null;
            }
            if (timeoutId == null)
                timeoutId = setTimeout(onTimeoutCallback, waitMS);
        }
        return operationProxy;
    }

    app.uuid = function() {
        let d = new Date().getTime();
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            d += performance.now();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            let r = (d + Math.random() * 16) % 16 | 0;
            d = Math.floor(d / 16);
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // Access the inner value of nested objects by the list of keys.
    app.byKeys = function(nestedObj, ...keys)  {
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            if (key in nestedObj) {
                nestedObj = nestedObj[key];
            } else {
                return; // not found
            }
        }
        return nestedObj;
    }

    app.reduceToMap = function(array, reduceFn) {
        return array.reduce( (map, item, index) => {
            reduceFn(map, item, index);
            return map;
        }, {});
    };

    app.pick = function(obj, ...keys) {
        return app.reduceToMap(keys, (map, key) => map[key] = obj[key]);
    }

    app.range = function*(begin, end, step = 1) {
        if (end === undefined) {
            end = begin;
            begin = 0;
        }
        for (let i = begin; step > 0 ? i < end : i > end; i += step) {
            yield i;
        }
    }    

    app.fmtPlural = function(count, baseWord, pluralWord) {
        return count <= 1 ? baseWord : (pluralWord ? pluralWord : baseWord + "s");
    }

    app.fmtNumWord = function(count, baseWord, pluralWord) {
        return count + " " + app.fmtPlural(count, baseWord, pluralWord);
    }

    app.formatId = function(strId) {
        return strId.replace(/[\W_]/g, '_');    // convert all non-alphanumeric and non-underscore to underscore.
    }

    app.padDigit5 = function(number) {
        return number <= 99999 ? ("0000"+number).slice(-5) : number;
    }

    app.pad = function(str, width=2, ch="0") {
        return (String(ch).repeat(width) + String(str)).slice(String(str).length)   // left padding
    }

    app.rpad = function(str, width=2, ch=" ") {
        return (String(str) + String(ch).repeat(width)).slice(0, Math.max(String(str).length, width))
    }

    app.hasAll = function(str, tokens, asLowerCase) {
        str = str || "";
        if (asLowerCase)
            str = str.toLowerCase();
        return tokens.every(token => token.length == 0 || str.indexOf(token) !== -1);
    }

    app.hasAny = function(str, tokens) {
        return tokens.some(token => token.length == 0 || str.indexOf(token) !== -1);
    }

    app.matchAny = function(str, tokens) {
        return tokens.some(token => token.length == 0 || str == token);
    }

    app.matchAnyFields = function(obj1, obj2, fieldKeys) {
        let matchedKeys = fieldKeys.filter( key => obj1[key] === obj2[key] );
        return matchedKeys.length > 0 || fieldKeys.length == 0;
    }

    app.matchAllFields = function(obj1, obj2, fieldKeys) {
        let matchedKeys = fieldKeys.filter( key => obj1[key] === obj2[key] );
        return matchedKeys.length == fieldKeys.length;
    }

    app.cmpStr = function(s1, s2) {
        if (s1 < s2) return -1;
        if (s1 > s2) return 1;
        return 0;
    }

    app.cmpArray = function(a1, a2) {
        if (a1 == null && a2 == null)
            return true;
        if (a1 == null || a2 == null)
            return false;
        return (a1.length == a2.length) && a1.every( (v,i) => v === a2[i] );
    }

    app.startsWithAny = function(str, list) {
        return (str && list) ? list.some( item => str.startsWith(item) ) : false;
    }

    app.toLower = function(tokens) {
        return tokens.map( token => token.toLowerCase() );
    }

    app.arrayToObj = function(array, keyField, valueField) {
        return array.reduce( (obj, item) => {
            obj[item[keyField]] = item[valueField];
            return obj;
        }, {});
    }

    // See https://docs.microsoft.com/en-us/windows/desktop/FileIO/naming-a-file
    const invalidFilenameChars = /<|>|\:|"|\/|\\|\||\?|\*/g;

    app.normalizeFilename = function(fileName, replacementChar) {
        return fileName.replace(invalidFilenameChars, replacementChar || "");
    }

    // Match any if items is empty.
    app.AnySet = class extends Set {
        constructor(items) {
            super(items);
            this.matchAny = !items || items.length == 0;
        }
        has(item) {
            return this.matchAny || super.has(item);
        }
    }

    app.pReadFile = function(html5File) {
        return new Promise(function(resolve, reject) {
            let asyncReader = new FileReader();
            asyncReader.onerror = event => reject(event.target.error);
            asyncReader.onabort = event => reject(event.target.error);
            asyncReader.onload  = event => resolve(event.target.result);
            asyncReader.readAsText(html5File);
        })
    }

    // Placeholder object to be placed at a variable, to throw error if accessed.
    app.uninitializedGuard = function(message) {
        return new Proxy({}, {
            get: function(target, name, receiver)        { throw Error("Object has not been initialized.  " + message) },
            set: function(target, name, value, receiver) { throw Error("Object has not been initialized.  " + message) },
        });
    }

    // deep copy
    app.cloneObj = function(obj) {
        if (obj === null)               return obj;
        if (typeof obj !== "object")    return obj; // primitive
        if (obj instanceof Date)        return new Date(obj.getTime());
        if (Array.isArray(obj))         return obj.map( x => app.cloneObj(x) );
        // clone an Object.
        return Object.keys(obj).reduce( (newObj, key) => {
            newObj[key] = app.cloneObj(obj[key]);
            return newObj;
        }, new obj.constructor());
    }

    const DATE_MILLISECONDS = 24*60*60*1000;

    // Use -days to offset back to a previous date.
    app.offsetByDays = function(date, days) {
        let newDate = new Date();
        newDate.setTime(date.getTime() + DATE_MILLISECONDS * days);
        return newDate;
    }

    log.info("module loaded");
    return app;

}());

export default the_module;


// Unit Tests
let _RUNTEST_APP = false;
if (_RUNTEST_APP) {
    console.log("Run app unit tests");

    let app = the_module;

    let obj1 = { a: 1, b: [2, 3], c: { x: 4, y: "y"} };
    let obj2 = app.cloneObj(obj1);
    
    obj1.a = 10;
    obj1.b[1] = 30;
    obj1.c.x  = 40;
    obj1.c.y  = "yy";
    console.assert( obj2.a == 1 );
    console.assert( obj2.b[1] == 3 );
    console.assert( obj2.c.x == 4);
    console.assert( obj2.c.y == "y");

    obj1 = {};
    obj2 = app.cloneObj(obj1);
    obj1.a = 1;
    console.assert( !obj2.hasOwnProperty("a") );
    console.assert( Object.keys(obj2).length == 0 );

}

