/*
  Tip Tab
  A Firefox extension to manage and navigate the browser tabs.
  Copyright (C) 2018  William Wong (williamw520@gmail.com)

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

// Setting module

(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    // import appcfg

    let log = new logger.Logger(appcfg.APPNAME, modulename, appcfg.LOGLEVEL);

    let module = function() { };        // Module object to be returned.
    if (scope && modulename)
        scope[modulename] = module;     // set module name in scope, otherwise caller sets the name with the returned module object.


    class TipTabSettings {

        constructor(jsonObj) {
            this._type = "TipTabSettings";
            this._version = 1;
            if (jsonObj) {
                this._fromObj(jsonObj);
            } else {
                this._newVersion1();
            }
        }

        _fromObj(jsonObj) {
            switch (jsonObj._version) {
            case 1:
                return this._fromVersion1(jsonObj);
            default:
                throw Error("Unsupported object version " + jsonObj._version);
            }
        }

        _newVersion1(capacity) {
            this.thumbnailPopup = true;
            this.showEmptyWindows = false;
            this.showEmptyContainers = true;
            this.realtimeUpdateThumbnail = true;
            this.enableHotKey = true;
            this.appHotKey = "";
        }

        _fromVersion1(jsonObj) {
            this.thumbnailPopup         = jsonObj.hasOwnProperty("thumbnailPopup") ? jsonObj.thumbnailPopup : true;
            this.showEmptyWindows       = jsonObj.hasOwnProperty("showEmptyWindows") ? jsonObj.showEmptyWindows : false;
            this.showEmptyContainers    = jsonObj.hasOwnProperty("showEmptyContainers") ? jsonObj.showEmptyContainers : true;
            this.realtimeUpdateThumbnail= jsonObj.hasOwnProperty("realtimeUpdateThumbnail") ? jsonObj.realtimeUpdateThumbnail : true;
            this.enableHotKey           = jsonObj.hasOwnProperty("enableHotKey") ? jsonObj.enableHotKey : true;
            this.appHotKey              = jsonObj.appHotKey || "";
            return this._validate();
        }

        _validate() {
            return this;
        }

    }

    function pLoad() {
        return browser.storage.local.get("tipTabSettings").then( results => new module.TipTabSettings(results.tipTabSettings) );
    }

    function pSave(tipTabSettings) {
        return browser.storage.local.set({ "tipTabSettings": tipTabSettings });
    }

    function pRemove() {
        return browser.storage.local.remove("tipTabSettings");
    }

    function pUpdate(property, value) {
        return pLoad().then(tipTabSettings => {
            tipTabSettings[property] = value;
            return tipTabSettings;
        }).then(pSave)
    }
    

    // Module export
    module.TipTabSettings = TipTabSettings;
    module.pLoad = pLoad;
    module.pSave = pSave;
    module.pRemove = pRemove;
    module.pUpdate = pUpdate;

    log.info("module loaded");
    return module;

}(this, "settings"));   // Pass in the global scope as 'this' scope.

